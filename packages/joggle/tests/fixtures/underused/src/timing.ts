/**
 * A retry delay assembled from a round millisecond literal.
 *
 * Nothing here imports a duration primitive: that absence is what the rule reads.
 */
export const retryDelay = (attempt: number): number => {
  const base = 1_000
  return base * attempt
}

/** Whether a start time is older than half a minute. */
export const isStale = (startedAt: number, now: number): boolean => now - startedAt > 30_000
