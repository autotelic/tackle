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
export const similarityOf = ({
  left,
  right,
}: {
  readonly left: ReadonlySet<string>
  readonly right: ReadonlySet<string>
}): number => {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  if (small.size === 0) return left.size === right.size ? 1 : 0
  let intersection = 0
  for (const shingle of small) if (large.has(shingle)) intersection += 1
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Containment over two shingle sets: the share of the SMALLER side that the
 * larger one also has.
 *
 * This exists beside `similarityOf` because Jaccard answers a different
 * question. Jaccard asks "was this edited?" -- it penalises a large addition
 * because the union grows with it, so a small declaration can be a complete
 * subset of a large one and still score 0.17. Containment asks "is this a
 * specialization of that?" -- every shingle of the smaller is in the larger, so
 * the relation survives the size difference. A collapse needs the second
 * question, and no threshold on the first can recover it.
 */
export const containmentOf = ({
  left,
  right,
}: {
  readonly left: ReadonlySet<string>
  readonly right: ReadonlySet<string>
}): number => {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  if (small.size === 0) return left.size === right.size ? 1 : 0
  let intersection = 0
  for (const shingle of small) if (large.has(shingle)) intersection += 1
  return intersection / small.size
}

/** Convenience for callers holding tokens rather than shingle sets. */
export const containment = ({
  left,
  right,
}: {
  readonly left: ReadonlyArray<string>
  readonly right: ReadonlyArray<string>
}): number => containmentOf({ left: shinglesOf(left), right: shinglesOf(right) })

/** Convenience for callers holding tokens rather than shingle sets. */
export const similarity = ({
  left,
  right,
}: {
  readonly left: ReadonlyArray<string>
  readonly right: ReadonlyArray<string>
}): number => similarityOf({ left: shinglesOf(left), right: shinglesOf(right) })

/**
 * How often each shingle appears across the documents being ranked.
 *
 * The containment join builds the same map internally for its prefix order. This
 * copy is for the rule's RANKING, where the question is different: a pair whose
 * shared shingles appear in every declaration is scaffolding, and a pair whose
 * shared shingles are rare is the finding.
 */
export const shingleFrequencyOf = (
  documents: Iterable<ReadonlySet<string>>,
): ReadonlyMap<string, number> => {
  const frequency = new Map<string, number>()
  for (const document of documents) {
    for (const shingle of document) {
      frequency.set(shingle, (frequency.get(shingle) ?? 0) + 1)
    }
  }
  return frequency
}

/**
 * A pair's shared shingles, as the intersection the containment score uses.
 *
 * Iterating the smaller side is the same reason `containmentOf` does: the
 * intersection cannot be larger than it.
 */
export const sharedShingles = ({
  left,
  right,
}: {
  readonly left: ReadonlySet<string>
  readonly right: ReadonlySet<string>
}): ReadonlyArray<string> => {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  const shared: Array<string> = []
  for (const shingle of small) if (large.has(shingle)) shared.push(shingle)
  return shared
}

/**
 * Inverse document frequency of a shared set, normalised to 0..1.
 *
 * A shingle unique to one declaration contributes 1; one present in every
 * declaration contributes 0. Averaging over the shared set means a pair is
 * down-ranked in proportion to how much of its overlap is scaffolding, not by
 * whether any single common shingle happens to appear. The log is the usual IDF
 * smoothing, and the normaliser is the IDF of the rarest possible shingle, so the
 * term stays bounded and multiply-safe.
 */
export const inverseFrequencyOf = ({
  shared,
  frequency,
  documents,
}: {
  readonly shared: Iterable<string>
  readonly frequency: ReadonlyMap<string, number>
  readonly documents: number
}): number => {
  if (documents <= 1) return 0
  const ceiling = Math.log((documents + 1) / 2)
  if (ceiling <= 0) return 0
  let total = 0
  let count = 0
  for (const shingle of shared) {
    const documentFrequency = frequency.get(shingle) ?? 0
    total += Math.log((documents + 1) / (documentFrequency + 1))
    count += 1
  }
  if (count === 0) return 0
  return Math.min(1, total / count / ceiling)
}

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

/** One entry's place in the sweep: size decides the order, slot the prefix. */
interface OrderedEntry {
  readonly size: number
  readonly slot: number
  readonly callerIndex: number
}

/**
 * The prefix-filter sweep both joins share.
 *
 * For threshold t with shingles ordered by ascending document frequency, if
 * containment(A, B) >= t and |A| <= |B| then |A n B| >= t|A|. A's prefix of
 * size ceil(t|A|) - 1 therefore cannot hold every shared shingle, so the prefix
 * of the smaller side always has one. Process sets by ascending size, index
 * prefixes, probe whole sets: every qualifying pair is visited exactly once,
 * with the smaller side already indexed.
 *
 * The caller supplies the scoring and the bound that scoring implies; this
 * function only guarantees the visit is complete. Both `allPairs` and
 * `allContainmentPairs` are differential-tested against a brute-force sweep, so
 * the guarantee is checked, not argued.
 */
const probePrefixes = (
  entries: ReadonlyArray<SizedShingles>,
  threshold: number,
  visit: (candidate: SizedShingles, current: SizedShingles) => void,
): void => {
  const frequency = shingleFrequencyOf(entries.map((entry) => entry.shingles))

  // Rarest first, so a prefix holds the most discriminating shingles and the
  // posting lists it produces stay short.
  const rank = new Map<string, number>()
  ;[...frequency.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .forEach(([shingle], position) => rank.set(shingle, position))

  const prefixes = entries.map((entry) => {
    const sorted = [...entry.shingles].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    const keep = Math.max(1, sorted.length - Math.ceil(threshold * sorted.length) + 1)
    return sorted.slice(0, keep)
  })

  const order: ReadonlyArray<OrderedEntry> = entries
    .map((entry, position) => ({
      size: entry.shingles.size,
      slot: position,
      callerIndex: entry.position,
    }))
    .filter((entry) => entry.size > 0)
    .sort((a, b) => a.size - b.size || a.callerIndex - b.callerIndex)

  const postings = new Map<string, Array<number>>()

  for (const current of order) {
    const entry = entries[current.slot]
    if (entry === undefined) continue

    // Probe with the whole set: only prefixes were indexed, and the smaller
    // side is always processed first, so its prefix is already there.
    const seen = new Set<number>()
    for (const shingle of entry.shingles) {
      const list = postings.get(shingle)
      if (list === undefined) continue
      for (const other of list) {
        if (other === current.slot || seen.has(other)) continue
        seen.add(other)
        const candidate = entries[other]
        if (candidate === undefined) continue
        visit(candidate, entry)
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
}

/**
 * Every pair at or above a Jaccard threshold, without comparing every pair.
 *
 * What this replaces compared every pair inside a size window: 3,280,085
 * comparisons for 7,034 declarations on one codebase, and that count grows as
 * n x window -- so ten times the code costs a hundred times the work. This
 * finds the same pairs while only scoring sets that share a rare shingle.
 *
 * A differential test asserts that this finds exactly what the brute-force
 * sweep in rule.ts finds.
 */
export const allPairs = (
  entries: ReadonlyArray<SizedShingles>,
  threshold: number,
): ReadonlyArray<ScoredPair> => {
  if (threshold <= 0) return []
  const pairs: Array<ScoredPair> = []
  probePrefixes(entries, threshold, (candidate, current) => {
    // Exact size filter: Jaccard cannot exceed the ratio of the smaller side to
    // the larger, so a pair outside it cannot qualify.
    if (candidate.shingles.size < threshold * current.shingles.size) return
    const score = similarityOf({ left: candidate.shingles, right: current.shingles })
    if (score < threshold) return
    const left = candidate.position
    const right = current.position
    pairs.push(left <= right ? { left, right, score } : { left: right, right: left, score })
  })
  return pairs
}

export interface ContainmentPair {
  /** The larger side's position in the caller's array. */
  readonly whole: number
  /** The smaller side's position in the caller's array. */
  readonly part: number
  /** |part n whole| / |part|. */
  readonly score: number
}

/**
 * Every containment pair at or above a threshold, without comparing every pair.
 *
 * The sweep is `probePrefixes`, with the direction fixed: each unordered pair is
 * reported once, with the smaller side named as `part`. Equal-sized pairs have
 * no smaller side, and the one processed first is kept as `part`.
 *
 * A differential test against a brute-force sweep is the contract: the join must
 * find exactly the pairs the sweep finds, not merely many of them.
 */
export const allContainmentPairs = (
  entries: ReadonlyArray<SizedShingles>,
  threshold: number,
): ReadonlyArray<ContainmentPair> => {
  if (threshold <= 0) return []
  const pairs: Array<ContainmentPair> = []
  probePrefixes(entries, threshold, (candidate, current) => {
    // An earlier entry is never larger, because the sweep is ascending by size.
    const score = containmentOf({ left: candidate.shingles, right: current.shingles })
    if (score < threshold) return
    pairs.push({ whole: current.position, part: candidate.position, score })
  })
  return pairs
}
