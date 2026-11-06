import { Effect } from "effect"
import { policy } from "../policy.ts"
import { rankSpeculative, similarClusters, similarPairs, strengthOf } from "../candidates.ts"
import { type Cluster } from "../cluster.ts"
import { budgetNote, outcome, type PlannedRule, type Scope } from "../rule.ts"
import { collapseQuestionnaire, planClusters, readClusters, type ClusterRule } from "./cluster-verdict.ts"
import { layersFrom } from "../architecture.ts"
import type { Workspace } from "../workspace.ts"
import { nameList } from "../cluster.ts"

const spec: ClusterRule = {
  ruleId: "joggle/duplicate-meaning",
  severity: "warn",
  move: "contract",
  // A near-duplicate is a guess until a judgement says otherwise, so an
  // unjudged cluster is silence and the rule reports itself as skipped.
  onUnavailable: "propagate",
  questionnaire: collapseQuestionnaire,
  nameOf: (cluster) =>
    `${cluster.members.length} declarations that may be one thing: ${nameList({ cluster })}`,
}

/*
 * Near-duplicates: structurally close but not identical, so someone renamed a
 * thing or the bodies drifted.
 *
 * Pair generation is COMPLETE, and it lives in the candidate engine now: the
 * shingle sweep visits every pair that could clear the threshold, so the only
 * bound left is on how many clusters are judged -- and that bound is ranked
 * rather than sliced.
 */
interface Candidates {
  readonly clusters: ReadonlyArray<Cluster>
  readonly oversized: ReadonlyArray<Cluster>
  /** Members left out because their group was a chain rather than a family. */
  readonly chained: number
}

const find = (workspace: Workspace, scope: Scope): Candidates => {
  const { minSimilarity, maxSimilarity, minTokens } = policy.duplicateMeaning
  const pairs = similarPairs({
    units: workspace.units,
    minTokens,
    minSimilarity,
    maxSimilarity,
    // Every kind is eligible; the engine keeps a pair to one kind.
    kinds: undefined,
    scope,
    separateTests: true,
  })
  const clustered = similarClusters({
    units: workspace.units,
    pairs,
    separateTests: true,
  })
  // A cluster bigger than the evidence panel cannot be a question. Only
  // `policy.evidence.maxMembers` of its members are ever shown, so the model is
  // asked about 105 declarations while looking at 12 of them -- and its answer
  // is the only one available: no. One repository produced "105 declarations
  // that may be one thing: down": every migration's `down` function, chained by
  // union-find, none of which can be deleted.
  //
  // The bound is not a new threshold. It is the size at which the evidence stops
  // being complete, which is the point at which the question stops being
  // answerable.
  const answerable = clustered.clusters.filter(
    (cluster) => cluster.members.length <= policy.evidence.maxMembers,
  )
  return {
    clusters: answerable,
    oversized: clustered.clusters.filter(
      (cluster) => cluster.members.length > policy.evidence.maxMembers,
    ),
    chained: clustered.chained,
  }
}

export const duplicateMeaning: PlannedRule = {
  id: spec.ruleId,
  severity: spec.severity,
  description: "Near-duplicates where a judgement says one declaration replaces the other.",
  judged: true,
  move: "contract",
  onUnavailable: spec.onUnavailable,
  plan: Effect.fn("joggle/duplicate-meaning")(function* (workspace, scope, context) {
    const { clusters, oversized, chained } = find(workspace, scope)
    const budget = policy.duplicateMeaning.maxClusters
    // Over budget, the clusters that get judged are the ones a reader is most
    // likely to care about: a relevance judgement over a deterministic window,
    // never a global sort by similarity (which is a selection, not a bound).
    const ordered = yield* rankSpeculative({
      budget,
      items: clusters.map((cluster) => ({
        item: cluster,
        strength: strengthOf({ score: cluster.overlap, members: cluster.members.length }),
        evidence: {
          names: cluster.members.slice(0, 4).map((member) => member.name),
          files: [...new Set(cluster.members.map((member) => member.file))].slice(0, 4),
          signal: Math.round(cluster.overlap * 100) + "% structurally similar",
        },
      })),
    })
    const phase = yield* planClusters(spec, ordered.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    const largest = ordered
      .slice(budget)
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 3)
      .map((cluster) => `${cluster.members.length}× ${spec.nameOf(cluster)}`)

    // Reported as drops rather than dropped silently: "476 declarations across 9
    // clusters were generated from one template" is a fact about the codebase,
    // and the only thing wrong with it was asking the model to confirm it.
    const tooManyToShow = oversized.map((cluster) => ({
      ruleId: spec.ruleId,
      subject: spec.nameOf(cluster),
      stage: "no_evidence" as const,
      reason:
        cluster.members.length +
        " declarations share a shape, which is more than the " +
        policy.evidence.maxMembers +
        " the evidence panel can show at once",
    }))

    const notes = [
      ...budgetNote({
        unitKind: "clusters",
        judged: budget,
        candidates: clusters.length,
        sample: largest,
      }),
      ...(oversized.length === 0
        ? []
        : [
            oversized.length +
              " cluster(s) were too large to be one decision (" +
              oversized.reduce((sum, cluster) => sum + cluster.members.length, 0) +
              " declarations): generated from one template rather than duplicated",
          ]),
      // What the clique requirement left out, because a silent narrowing is the
      // thing this program keeps having to design against. These are members
      // that resembled their neighbours without resembling each other.
      ...(chained === 0
        ? []
        : [
            chained +
              " declaration(s) were left out of a cluster: they resembled a neighbour without resembling every member, so grouping them would have made a chain rather than a family",
          ]),
    ]
    return {
      plans: phase.planned.map((entry) => entry.plan),
      read: (answers) => {
        const judged = readClusters(spec, workspace, phase, layers, answers)
        return outcome(judged.diagnostics, notes, [...tooManyToShow, ...judged.drops])
      },
    }
  }),
}
