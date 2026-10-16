import { Order } from "effect"
import type { Unit } from "./workspace.ts"

/**
 * A group of declarations a rule believes are one thing, and therefore one
 * decision.
 *
 * Rules used to emit a finding per pair. A five-copy family became four
 * findings, and the "canonical" one was whichever sorted first by path, so the
 * report advised keeping `lookupUserById` over `findUserById` for no reason
 * other than the alphabet. Clusters make the actionable unit explicit: N copies,
 * one decision, one report -- and the choice of which to keep becomes something
 * the model decides rather than something `sort` decides.
 *
 * Clustering is only meaningful when the relation is transitive. Identical
 * shape and near-identical bodies are: if A is a copy of B and B of C, all three
 * are one thing. Names are not -- see naming-drift -- and that rule now judges
 * pairs instead.
 */
export interface Cluster {
  /** Ordered by path so runs stay deterministic. The first is the code's guess. */
  readonly members: ReadonlyArray<Unit>
  /** True when every member has the same shape hash. */
  readonly identical: boolean
  /** Highest pairwise structural overlap in the cluster. */
  readonly overlap: number
  /**
   * True when at least one member carries a type annotation.
   *
   * When no member does, the cluster was formed from SHAPE ALONE: two `.js`
   * declarations with the same token shape and nothing to tell them apart. The
   * finding is still true -- they really do share a shape -- but it is weaker
   * evidence than the same finding in typed code, and it has to say so, because
   * in a JavaScript codebase it is the common case rather than the exception.
   */
  readonly typed: boolean
}

/** Connected components over an edge list, by union-find with path compression. */
export const components = (
  size: number,
  edges: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<ReadonlyArray<number>> => {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (start: number): number => {
    let root = start
    for (;;) {
      const next = parent[root]
      if (next === undefined || next === root) break
      root = next
    }
    let cursor = start
    while (cursor !== root) {
      const next = parent[cursor]
      if (next === undefined || next === root) break
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  for (const [left, right] of edges) {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent[a] = b
  }
  const groups = new Map<number, Array<number>>()
  for (let index = 0; index < size; index += 1) {
    const root = find(index)
    const group = groups.get(root)
    if (group === undefined) groups.set(root, [index])
    else group.push(index)
  }
  return [...groups.values()]
}

const byPath: Order.Order<Unit> = Order.combine(
  Order.mapInput(Order.String, (unit: Unit) => unit.file),
  Order.mapInput(Order.Number, (unit: Unit) => unit.start),
)

/**
 * Build a cluster: its members in path order, whether they are identical, how
 * much they overlap, and whether any member carries a type.
 */
export const clusterOf = (
  members: ReadonlyArray<Unit>,
  identical: boolean,
  overlap: number,
): Cluster => ({
  members: [...members].sort(byPath),
  identical,
  overlap,
  // Computed here rather than passed in, so a caller cannot forget it or set it
  // wrong.
  typed: members.some((member) => member.typed),
})

/** The distinct declaration names in a cluster, in member order. */
export const namesOf = (cluster: Cluster): ReadonlyArray<string> => [
  ...new Set(cluster.members.map((member) => member.name)),
]

/**
 * Names of a cluster, capped for display.
 *
 * An eighty-seven member cluster once printed all eighty-seven names into a
 * note. A message is not a directory listing; the count carries the information
 * and the first few carry the gist.
 */
export const nameList = (cluster: Cluster, max = 4): string => {
  const names = namesOf(cluster)
  if (names.length <= max) return names.join(", ")
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`
}
