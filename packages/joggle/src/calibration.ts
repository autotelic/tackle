/**
 * Whether a question is worth its gate.
 *
 * abide's calibration, kept whole: a question answers near 0 or near 1 on real
 * states when it is decisive; a question whose answers sit in the middle is weak
 * (it is guessing); a question that fires on most states is noisy (its criteria
 * are too loose). Below a handful of states there is nothing to say.
 *
 * `fired` uses joggle's own act threshold, so "noisy" means the same thing here
 * as it does in a run.
 */
const MIN_STATES = 5
/** Below this a "no" is confident. */
const CONFIDENT_NO = 0.25
/** At or above this a "yes" is clear. */
const CLEAR_YES = 0.7
/** Firing on this share of states is a question that says yes to everything. */
const NOISY_RATE = 0.6

export type CalibrationVerdict = "decisive" | "weak" | "noisy" | "skipped"

export interface CalibrationSummary {
  readonly states: number
  readonly median: number
  readonly min: number
  readonly max: number
  readonly fired: number
  readonly verdict: CalibrationVerdict
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  const low = sorted[middle - 1] ?? 0
  const high = sorted[middle] ?? 0
  return (low + high) / 2
}

/** One state: the violation probability, and whether the band would act on it. */
export interface CalibrationState {
  readonly probability: number
  /** `act` from the rule's own gate -- margin and confidence included. */
  readonly acted: boolean
}

/**
 * Summarize one question's answers over real states.
 *
 * `fired` counts the states the BAND would act on, not the ones above the
 * probability floor: a rule whose answers are above the floor but below the
 * margin is not flooding the report, it is flagging, and calibration that cannot
 * see the difference calls it noisy when the report is quiet.
 *
 * @param states - one per candidate the rule produced: P(violated) from
 *   `verdictOf`, and whether the gate would act.
 * @returns the counts and the verdict: decisive, weak, noisy, or skipped when
 *   there were too few states to say.
 */
export const summarizeCalibration = (states: ReadonlyArray<CalibrationState>): CalibrationSummary => {
  const probabilities = states.map((state) => state.probability)
  const count = states.length
  const med = median(probabilities)
  const min = count === 0 ? 0 : Math.min(...probabilities)
  const max = count === 0 ? 0 : Math.max(...probabilities)
  const fired = states.filter((state) => state.acted).length
  let verdict: CalibrationVerdict
  if (count < MIN_STATES) verdict = "skipped"
  else if (fired / count >= NOISY_RATE) verdict = "noisy"
  else if (max < CLEAR_YES && med >= CONFIDENT_NO) verdict = "weak"
  else verdict = "decisive"
  return { states: count, median: med, min, max, fired, verdict }
}
