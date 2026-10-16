import { Effect } from "effect"
import { policy } from "../policy.ts"
import { components, clusterOf, type Cluster } from "../cluster.ts"
import { budgetNote, inScope, outcome, type PlannedRule, type Scope } from "../rule.ts"
import { allPairs, type ScoredPair } from "../similarity.ts"
import { collapseQuestionnaire, planClusters, readClusters, type ClusterRule } from "./cluster-verdict.ts"
import { layersFrom } from "../architecture.ts"
import type { Unit, Workspace } from "../workspace.ts"
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
    `${cluster.members.length} declarations that may be one thing: ${nameList(cluster)}`,
}

/**
 * Only declarations of the same kind, in different files, can be one thing --
 * and when scoped, at least one side has to be the side that changed.
 */
const candidatePair = (
  units: ReadonlyArray<Unit>,
  scope: Scope,
  pair: ScoredPair,
): boolean => {
  const one = units[pair.left]
  const two = units[pair.right]
  if (one === undefined || two === undefined) return false
  if (one.file === two.file || one.kind !== two.kind) return false
  return inScope(scope, one.file) || inScope(scope, two.file)
}

/*
 * Near-duplicates: structurally close but not identical, so someone renamed a
 * thing or the bodies drifted.
 *
 * Pair generation is COMPLETE. It used to be a global sort by similarity with a
 * slice, which is a selection rather than a bound: forty high-scoring pairs
 * elsewhere in the tree could spend the whole budget and leave the eighteen
 * definitions of one helper never compared. The sweep visits every pair that
 * could clear the threshold, and the only bound left is on how many clusters
 * are judged.
 */
/**
 * Candidates, and the clusters that are not questions.
 *
 * Split in two rather than filtered, because an oversized cluster is worth
 * SAYING something about -- it is real evidence that N declarations were
 * generated from one template -- while not being worth asking about.
 */
interface Candidates {
  readonly clusters: ReadonlyArray<Cluster>
  readonly oversized: ReadonlyArray<Cluster>
  /** Members left out because their group was a chain rather than a family. */
  readonly chained: number
}

const find = (workspace: Workspace, scope: Scope): Candidates => {
  const { minSimilarity, maxSimilarity, minTokens } = policy.duplicateMeaning

  const units = workspace.units
  const eligible = units
    .map((unit, index) => ({ unit, index }))
    .filter((entry) => entry.unit.tokens.length >= minTokens)

  const candidates = allPairs(
    eligible.map((entry) => ({ position: entry.index, shingles: entry.unit.shingles })),
    minSimilarity,
  )

  const pairs: Array<ScoredPair> = candidates.filter(
    (pair) => pair.score <= maxSimilarity && candidatePair(units, scope, pair),
  )

  // Similarity is NOT transitive, and union-find over a non-transitive relation
  // does not produce concepts. If A resembles B and B resembles C, A and C can
  // have nothing in common -- and across a codebase that chains hundreds of
  // declarations into one "concept". One repository produced:
  //
  //   105 declarations that may be one thing: down
  //
  // which was every migration's `down` function: each one differs from its
  // neighbours by a table name, so each pair cleared the threshold and the chain
  // closed around all of them.
  //
  // The model cannot answer that, and the answer it gives is the only one
  // available. So a cluster now has to be a CLIQUE: every member similar to every
  // other member, which is the condition that makes "these N are one thing" a
  // question rather than a path through a graph.
  const scoreOf = new Map<string, number>()
  const adjacency = new Map<number, Set<number>>()
  const link = (from: number, to: number): void => {
    const existing = adjacency.get(from)
    if (existing === undefined) adjacency.set(from, new Set([to]))
    else existing.add(to)
  }
  for (const pair of pairs) {
    scoreOf.set(pair.left + ":" + pair.right, pair.score)
    scoreOf.set(pair.right + ":" + pair.left, pair.score)
    link(pair.left, pair.right)
    link(pair.right, pair.left)
  }
  const adjacent = (one: number, other: number): boolean =>
    adjacency.get(one)?.has(other) === true

  const groups = components(
    workspace.units.length,
    pairs.map((pair): readonly [number, number] => [pair.left, pair.right]),
  )

  let chained = 0
  const clusters: Array<Cluster> = []
  for (const group of groups) {
    if (group.length < 2) continue
    // Largest-clique-first: the member with the most neighbours starts, and a
    // member joins only if it is adjacent to everything already chosen. Greedy
    // rather than maximal, which is enough -- the alternative is a smaller
    // cluster, not a wrong one.
    const ordered = [...group].sort(
      (left, right) => (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0),
    )
    const clique: Array<number> = []
    for (const index of ordered) {
      if (clique.every((member) => adjacent(index, member))) clique.push(index)
    }
    chained += group.length - clique.length
    if (clique.length < 2) continue

    const members = clique
      .map((index) => workspace.units[index])
      .filter((unit): unit is Unit => unit !== undefined)
    if (members.length < 2) continue
    // Test fixtures are compared only against each other.
    if (members.every((unit) => unit.test)) continue

    let overlap = 0
    for (let a = 0; a < clique.length; a += 1) {
      for (let b = a + 1; b < clique.length; b += 1) {
        const left = clique[a]
        const right = clique[b]
        if (left === undefined || right === undefined) continue
        const score = scoreOf.get(left + ":" + right) ?? 0
        if (score > overlap) overlap = score
      }
    }
    clusters.push(clusterOf(members, false, overlap))
  }
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
  const answerable = clusters.filter(
    (cluster) => cluster.members.length <= policy.evidence.maxMembers,
  )
  return {
    clusters: answerable,
    oversized: clusters.filter((cluster) => cluster.members.length > policy.evidence.maxMembers),
    chained,
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
    const phase = yield* planClusters(spec, clusters.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    const largest = clusters
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
