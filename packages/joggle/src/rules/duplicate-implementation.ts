import { Effect } from "effect"
import { policy } from "../policy.ts"
import { exactGroups } from "../candidates.ts"
import { clusterOf, type Cluster } from "../cluster.ts"
import { type PlannedRule, type Scope } from "../rule.ts"
import {
  collapseQuestionnaire,
  planBudgetedClusters,
  type ClusterRule,
} from "./cluster-verdict.ts"
import type { Workspace } from "../workspace.ts"

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
const find = (workspace: Workspace, scope: Scope): ReadonlyArray<Cluster> =>
  exactGroups({
    units: workspace.units,
    kinds: ["shape"],
    minTokens: policy.duplicateImplementation.minTokens,
    // Same-file copies count: `bundles.ts` carried `blocksIn` and `declares` three
    // lines apart with identical bodies, and `distinctFiles: true` made every
    // duplicate rule blind to it. Two declarations in one file that share a shape
    // and differ in name are the cheapest kind of duplication to see and the
    // easiest to fix.
    distinctFiles: false,
    separateTests: true,
    scope,
  }).map((group) => clusterOf(group.members, true, 1))

export const duplicateImplementation: PlannedRule = {
  id: spec.ruleId,
  severity: spec.severity,
  description: "One declaration written more than once across files.",
  judged: true,
  move: "contract",
  onUnavailable: spec.onUnavailable,
  plan: Effect.fn("joggle/duplicate-implementation")(function* (workspace, scope, context) {
    const clusters = find(workspace, scope)
    const budget = policy.duplicateImplementation.maxClusters
    const shapeOnly = clusters.filter((cluster) => !cluster.typed).length
    return yield* planBudgetedClusters({
      rule: spec,
      clusters,
      budget,
      scope,
      workspace,
      context,
      emptyNote: "no two declarations share a shape, so there was nothing to compare",
      // Visibility for the missing type signal. In a `.js` codebase every
      // cluster is shape-only, and a reader who cannot see that will read the
      // findings as typed evidence.
      notes:
        shapeOnly === 0
          ? []
          : [
              `${shapeOnly} of ${clusters.length} cluster(s) were compared by shape alone: no member carries a type annotation`,
            ],
    })
  }),
}
