/*
 * Shingle sets, Jaccard similarity, and the all-pairs join that uses them.
 *
 * This module exists because the join and the similarity it verifies with have
 * to agree on what a set is. Splitting them across two files is how you end up
 * with a candidate generator and a scorer that disagree about the answer.
 */

/** Token bigrams, the unit of comparison between two declarations. */
export const shinglesOf = (tokens: ReadonlyArray<string>): ReadonlySet<string> => {
  const set = new Set<string>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    set.add(`${tokens[index]}\u0000${tokens[index + 1]}`)
  }
  return set
}

/**
 * Jaccard similarity over two shingle sets.
 *
 * Iterates the smaller side: an intersection cannot be larger than it, and for
 * the size-skewed pairs a threshold admits, that is most of the work saved.
 */
export const similarityOf = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number => {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  if (small.size === 0) return left.size === right.size ? 1 : 0
  let intersection = 0
  for (const shingle of small) if (large.has(shingle)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Convenience for callers holding tokens rather than shingle sets. */
export const similarity = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number => similarityOf(shinglesOf(left), shinglesOf(right))

export interface SizedShingles {
  /** Position in the caller's array, so results refer to the caller's data. */
  readonly position: number
  readonly shingles: ReadonlySet<string>
}

export interface ScoredPair {
  readonly left: number
  readonly right: number
  readonly score: number
}

/**
 * Every pair at or above a Jaccard threshold, without comparing every pair.
 *
 * What this replaces compared every pair inside a size window: 3,280,085
 * comparisons for 7,034 declarations on one codebase, and that count grows as
 * n x window -- so ten times the code costs a hundred times the work. This
 * finds the same pairs while only scoring sets that share a rare shingle.
 *
 * The guarantee, for threshold t with shingles ordered by ascending document
 * frequency: if J(A, B) >= t and |A| <= |B|, then |A n B| >= t|A|. A's prefix
 * excludes only ceil(t|A|) - 1 shingles, fewer than t|A|, so at least one shared
 * shingle must lie in A's prefix. Index prefixes, probe whole sets, and no
 * qualifying pair can be missed. A differential test asserts that this finds
 * exactly what the brute-force sweep in rule.ts finds.
 */
export const allPairs = (
  entries: ReadonlyArray<SizedShingles>,
  threshold: number,
): ReadonlyArray<ScoredPair> => {
  if (threshold <= 0) return []

  const frequency = new Map<string, number>()
  for (const entry of entries) {
    for (const shingle of entry.shingles) {
      frequency.set(shingle, (frequency.get(shingle) ?? 0) + 1)
    }
  }

  // Rarest first, so a prefix holds the most discriminating shingles and the
  // posting lists it produces stay short.
  const rank = new Map<string, number>()
  ;[...frequency.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .forEach(([shingle], position) => rank.set(shingle, position))

  const prefixes = entries.map((entry) => {
    const sorted = [...entry.shingles].sort(
      (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
    )
    const keep = Math.max(1, sorted.length - Math.ceil(threshold * sorted.length) + 1)
    return sorted.slice(0, keep)
  })

  const order = entries
    .map((entry, position) => ({ size: entry.shingles.size, slot: position, callerIndex: entry.position }))
    .filter((entry) => entry.size > 0)
    .sort((a, b) => a.size - b.size || a.callerIndex - b.callerIndex)

  const postings = new Map<string, Array<number>>()
  const pairs: Array<ScoredPair> = []

  for (const current of order) {
    const entry = entries[current.slot]
    if (entry === undefined) continue

    // Probe with the whole set. Only prefixes were indexed, and the argument
    // above says the shared shingle lies in the smaller side's prefix -- which
    // is already indexed, because the smaller side is always processed first.
    const seen = new Set<number>()
    for (const shingle of entry.shingles) {
      const list = postings.get(shingle)
      if (list === undefined) continue
      for (const other of list) {
        if (other === current.slot || seen.has(other)) continue
        seen.add(other)
        const candidate = entries[other]
        if (candidate === undefined) continue
        // Exact size filter: Jaccard cannot exceed the ratio of the smaller side
        // to the larger, so a pair outside it cannot qualify.
        if (candidate.shingles.size < threshold * entry.shingles.size) continue
        const score = similarityOf(candidate.shingles, entry.shingles)
        if (score < threshold) continue
        const left = candidate.position
        const right = entry.position
        pairs.push(left <= right ? { left, right, score } : { left: right, right: left, score })
      }
    }

    const prefix = prefixes[current.slot]
    if (prefix === undefined) continue
    for (const shingle of prefix) {
      const list = postings.get(shingle)
      if (list === undefined) postings.set(shingle, [current.slot])
      else list.push(current.slot)
    }
  }

  return pairs
}
