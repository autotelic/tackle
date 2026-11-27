/**
 * The p-th percentile of a sample, by linear interpolation.
 *
 * A policy constant is a person's guess wearing a number. Where the repository
 * itself has a distribution, the cutoff should be read from it and reported with
 * the population it came from, so a reader can disagree with the number by
 * looking at the same evidence.
 *
 * `p` is on [0, 100]. The sample is sorted; the result lies between the two
 * nearest order statistics, which is the usual definition and the one a reader
 * of "the 75th percentile" expects. An empty sample has no percentile, so the
 * answer is 0 and the caller must report that it had no population.
 *
 * @param values - the observed values.
 * @param p - the percentile, from 0 to 100.
 * @returns the interpolated percentile, or 0 for an empty sample.
 */
export const percentile = (values: ReadonlyArray<number>, p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const clamped = Math.min(100, Math.max(0, p))
  const rank = (clamped / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const first = sorted[low]
  const second = sorted[high]
  if (first === undefined) return 0
  if (second === undefined || low === high) return first
  return first + (second - first) * (rank - low)
}
