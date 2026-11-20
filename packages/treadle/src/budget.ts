/**
 * Budget consumption (#18, "bound damage, not work"): a Pass consumes the
 * issue's budget when it fails to make verified progress. The unit of
 * verified progress is the Failure set shrinking — a failed Pass whose
 * frontier is strictly smaller than the previous one did real work, so it
 * is exempt and the next Pass starts from the same budget. Everything else
 * — equal frontier, larger frontier, no prior frontier, a stalled Pass —
 * consumes. The stall circuit-breaker (rules.ts) bounds grinding
 * independently of this rule, so exemptions can't run away.
 */

export type ConsumptionInput = {
  /** The previous Pass's |Failure set|, or null for the first Pass. */
  previousFrontier: number | null
  /** This Pass's |Failure set|. */
  frontier: number
}

export function passConsumesBudget({ previousFrontier, frontier }: ConsumptionInput): boolean {
  if (previousFrontier === null) return true
  return frontier >= previousFrontier
}
