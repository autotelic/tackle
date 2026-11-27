/**
 * Retry delays assembled from round millisecond literals.
 *
 * Nothing here imports a duration primitive: that absence is what the rule reads.
 * Three declarations, because three are a capability and two are a coincidence.
 */
export const retryDelay = (attempt: number): number => {
  const base = 1_000
  return base * attempt
}

/** Whether a start time is older than half a minute. */
export const isStale = (startedAt: number, now: number): boolean => now - startedAt > 30_000

/** How long a cached answer stays warm. */
export const cacheLifetime = (): number => 60_000
