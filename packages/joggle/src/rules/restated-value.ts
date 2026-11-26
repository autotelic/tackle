import { Effect } from "effect"
import { layersFrom } from "../architecture.ts"
import { exactGroups } from "../candidates.ts"
import { clusterOf, type Cluster } from "../cluster.ts"
import { policy } from "../policy.ts"
import { budgetNote, outcome, type PlannedRule, type Scope } from "../rule.ts"
import type { Unit, Workspace } from "../workspace.ts"
import {
  clusterReporter,
  collapseQuestionnaire,
  largestClusters,
  planClusters,
  readClusters,
  unverifiedFinding,
  type ClusterRule,
} from "./cluster-verdict.ts"

const RULE_ID = "joggle/restated-value"

/**
 * One vocabulary declared in more than one place.
 *
 * `values` has been a declared join key since the candidate generator was
 * written -- `Unit` carries it, `keyOf` implements it -- and until now no rule
 * read it. That is the cheapest form of the thing this engine exists to find: a
 * fact with more than one home and no edge between them.
 *
 * Deliberately narrow. This reads DECLARED literals -- `const ROLES = [...] as
 * const`, an enum's members -- so a string typed into a function body is not a
 * candidate here. Widening it means reading literal sites inside bodies, which
 * is a different pass, and claiming that this rule found them would be a lie.
 *
 * The two negatives are the point. Two declarations of the same vocabulary are
 * NOT a finding when one imports the other: they share a home already, and the
 * second is a re-export rather than a copy. And a single-value declaration is
 * not a vocabulary; it is a constant, and its name is its home.
 */
const spec: ClusterRule = {
  ruleId: RULE_ID,
  severity: "warn",
  move: "contract",
  // Equality of two literal sets is a fact, so an unjudged cluster is still
  // worth a reader's attention.
  onUnavailable: "report",
  questionnaire: collapseQuestionnaire,
  nameOf: (cluster) => {
    const values = cluster.members[0]?.values ?? []
    const shown = values.slice(0, 3).join(", ")
    const rest = values.length > 3 ? ", …" : ""
    return `[${shown}${rest}] is declared ${cluster.members.length} times`
  },
}

/**
 * The members that have no home among their own cluster.
 *
 * A declaration is homed when its file imports, from another member's file, a
 * declaration carrying the same values. That is a re-declaration beside its own
 * source rather than a second home, and reporting it would punish the case the
 * rule exists to produce. Dropped per MEMBER, not per cluster: one homed copy
 * must not excuse the two independent ones beside it.
 */
const independentOf = (workspace: Workspace, members: ReadonlyArray<Unit>): ReadonlyArray<Unit> =>
  members.filter((member) => {
    const from = workspace.imports.edges.filter((edge) => edge.importer === member.file)
    return !members.some(
      (other) => other.file !== member.file && from.some((edge) => edge.to === other.file),
    )
  })

const find = (workspace: Workspace, scope: Scope): ReadonlyArray<Cluster> =>
  exactGroups({
    units: workspace.units,
    kinds: ["values"],
    minTokens: policy.restatedValue.minTokens,
    distinctFiles: true,
    separateTests: true,
    scope,
  })
    .filter((group) => (group.members[0]?.values.length ?? 0) >= policy.restatedValue.minValues)
    // The home filter runs per member, and a cluster survives only if two
    // independent declarations remain: one copy beside its own source has a home
    // and is not a second one.
    .flatMap((group) => {
      const independent = independentOf(workspace, group.members)
      return independent.length < 2 ? [] : [clusterOf(independent, true, 1)]
    })

export const restatedValue: PlannedRule = {
  id: spec.ruleId,
  severity: spec.severity,
  description: "One vocabulary declared in more than one place.",
  judged: true,
  move: spec.move,
  onUnavailable: spec.onUnavailable,
  plan: Effect.fn("joggle/restated-value")(function* (workspace, scope, context) {
    const clusters = find(workspace, scope)
    if (clusters.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no two declarations name the same set of literal values"]),
      }
    }
    const budget = policy.restatedValue.maxClusters
    const phase = yield* planClusters(spec, clusters.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    const report = clusterReporter(spec, workspace)
    const overflow = clusters
      .slice(budget)
      .map((cluster) => unverifiedFinding({ report, rule: spec, cluster }))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    const notes = [
      ...budgetNote({
        unitKind: "clusters",
        judged: budget,
        candidates: clusters.length,
        sample: largestClusters(clusters.slice(budget), spec.nameOf),
      }),
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
