import { Effect } from "effect"
import { policy } from "../policy.ts"
import { clusterOf, type Cluster } from "../cluster.ts"
import { budgetNote, inScope, outcome, type PlannedRule, type Scope } from "../rule.ts"
import {
  clusterReporter,
  collapseQuestionnaire,
  planClusters,
  readClusters,
  unverifiedFinding,
  type ClusterRule,
} from "./cluster-verdict.ts"
import { layersFrom } from "../architecture.ts"
import type { Unit, Workspace } from "../workspace.ts"

const spec: ClusterRule = {
  ruleId: "joggle/duplicate-implementation",
  severity: "warn",
  move: "contract",
  // Shape equality is a fact, so an unjudged cluster is still worth reporting.
  onUnavailable: "report",
  questionnaire: collapseQuestionnaire,
  nameOf: (cluster) => {
    const names = [...new Set(cluster.members.map((member) => member.name))]
    return names.length === 1
      ? `\`${names[0] ?? "?"}\` is declared ${cluster.members.length} times`
      : `${cluster.members.length} declarations share one shape`
  },
}

/**
 * A shape group *is* a cluster: every member has the same shape hash and the
 * same resolved type identity. Broad on purpose -- over-production is the
 * judge's problem, a missed copy is not.
 */
const find = (workspace: Workspace, scope: Scope): ReadonlyArray<Cluster> => {
  const groups = new Map<string, Array<Unit>>()
  const { minTokens } = policy.duplicateImplementation
  for (const unit of workspace.units) {
    if (unit.tokens.length < minTokens) continue
    // Resolved types are part of the key: two helpers that read identically but
    // reference different declared types are not the same helper.
    const key = `${unit.kind}:${unit.shapeHash}:${unit.typeSignature}`
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, [unit])
    else existing.push(unit)
  }

  const clusters: Array<Cluster> = []
  for (const group of groups.values()) {
    if (new Set(group.map((unit) => unit.file)).size < 2) continue
    // Test fixtures are compared only against each other.
    if (group.every((unit) => unit.test)) continue
    // A new duplicate always has at least one changed member: nothing else can
    // have created it, so a group nobody touched cannot produce a new finding.
    if (!group.some((unit) => inScope(scope, unit.file))) continue
    clusters.push(clusterOf(group, true, 1))
  }
  return clusters
}

/** Largest clusters first when a budget bites, so the note names what matters. */
const largestOf = (clusters: ReadonlyArray<Cluster>): ReadonlyArray<string> =>
  [...clusters]
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 3)
    .map((cluster) => `${cluster.members.length}× ${spec.nameOf(cluster)}`)

export const duplicateImplementation: PlannedRule = {
  id: spec.ruleId,
  severity: spec.severity,
  description: "One declaration written more than once across files.",
  judged: true,
  move: "contract",
  onUnavailable: spec.onUnavailable,
  plan: Effect.fn("joggle/duplicate-implementation")(function* (workspace, scope, context) {
    const clusters = find(workspace, scope)
    if (clusters.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no two declarations share a shape, so there was nothing to compare"]),
      }
    }
    const budget = policy.duplicateImplementation.maxClusters
    const shapeOnly = clusters.filter((cluster) => !cluster.typed).length
    const phase = yield* planClusters(spec, clusters.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    // Over budget: the fact is still reported, unjudged and labelled as such.
    const report = clusterReporter(spec, workspace)
    const overflow = clusters
      .slice(budget)
      .map((cluster) => unverifiedFinding(report, spec, cluster))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    const notes = [
      ...budgetNote({
        unitKind: "clusters",
        judged: budget,
        candidates: clusters.length,
        sample: largestOf(clusters.slice(budget)),
      }),
      // Visibility for the missing type signal. In a `.js` codebase every
      // cluster is shape-only, and a reader who cannot see that will read the
      // findings as typed evidence.
      ...(shapeOnly === 0
        ? []
        : [
            `${shapeOnly} of ${clusters.length} cluster(s) were compared by shape alone: no member carries a type annotation`,
          ]),
    ]
    return {
      plans: phase.planned.map((entry) => entry.plan),
      read: (answers) => {
        const judged = readClusters(spec, workspace, phase, layers, answers)
        return outcome([...judged.diagnostics, ...overflow], notes, judged.drops)
      },
    }
  }),
}
