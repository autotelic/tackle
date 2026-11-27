import { canonical } from "./canonical.ts"
import { shortHash } from "./state.ts"

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

/* -------------------------------------------------------------------------- */
/* The split                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One judged answer, as a train/test split sees it.
 *
 * The corpus repeats itself: the same declaration body in two files, two rules
 * asking the same question of it, and a question re-asked against the same
 * evidence all read as separate observations. A split that treats them as
 * separate lets a test observation be answered by its own duplicate in train,
 * which is the leakage that dismantled the "Golden Features" result (ICSE 2022,
 * `10.1145/3510003.3510214`).
 */
export interface Observation {
  /**
   * The decision cache key -- model + state + questions, computed by
   * `answerKeyFor` (the per-question form of `cacheKeyFor`). Two answers with the
   * same key are one observation and must land on the same side.
   */
  readonly key: string
  /** The atom that named the candidate: what the old partition used. */
  readonly atom: string
  /** The fragment-set hash of the evidence, so an exact duplicate is withheld. */
  readonly fragments: string
  /** The answer, reduced to the label agreement is measured about. */
  readonly label: string
}

/** The hash of a fragment set: order is not identity, so it is sorted first. */
export const fragmentSetHash = (ids: ReadonlyArray<string>): string =>
  shortHash(canonical([...new Set(ids)].sort()))

/** One side's count, and how often the training side agreed with it. */
export interface SplitAgreement {
  readonly train: number
  readonly test: number
  readonly agreed: number
  /** `agreed / test`, and 0 when no observation was held out. */
  readonly rate: number
}

/** What a split measured, both ways. */
export interface SplitReport {
  readonly observations: number
  /** Answers to the same key, collapsed to one observation rather than withheld. */
  readonly collapsed: number
  /** Exact duplicates of an earlier fragment set, withheld before the split. */
  readonly withheld: number
  /** The old number: partition by atom, duplicates and all. */
  readonly byAtom: SplitAgreement
  /** Rung 0: partition by cache key, after exact duplicates are withheld. */
  readonly byKey: SplitAgreement
}

/** The side a value lands on: its own hash, so the assignment is stable. */
const sideOf = (value: string): 0 | 1 => ((parseInt(shortHash(value).slice(0, 2), 16) & 1) as 0 | 1)

/** Cut observations into a train and a test side by one field. */
export const partition = (
  observations: ReadonlyArray<Observation>,
  by: (observation: Observation) => string,
): { readonly train: ReadonlyArray<Observation>; readonly test: ReadonlyArray<Observation> } => {
  const train: Array<Observation> = []
  const test: Array<Observation> = []
  for (const observation of observations) {
    if (sideOf(by(observation)) === 0) train.push(observation)
    else test.push(observation)
  }
  return { train, test }
}

/** The most common label, ties broken by name so the answer is one value. */
const majority = (labels: ReadonlyArray<string>): string | undefined => {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  let best: string | undefined
  let bestCount = -1
  for (const [label, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && label < best)) {
      best = label
      bestCount = count
    }
  }
  return best
}

/**
 * How often the training side agrees with the held-out side.
 *
 * A test observation is predicted from the training observations that share its
 * fragment set -- the evidence itself, so an exact duplicate answers by memory --
 * and from the training side's majority answer when that evidence is new. The
 * rate is the accuracy of that one-nearest-neighbour baseline, which is exactly
 * what a duplicated corpus inflates: withheld duplicates take the memorised
 * answer away, so what survives is the agreement between genuinely distinct
 * observations.
 */
export const agreement = (
  train: ReadonlyArray<Observation>,
  test: ReadonlyArray<Observation>,
): SplitAgreement => {
  const byFragments = new Map<string, Array<string>>()
  for (const observation of train) {
    const labels = byFragments.get(observation.fragments) ?? []
    labels.push(observation.label)
    byFragments.set(observation.fragments, labels)
  }
  const fallback = majority(train.map((observation) => observation.label))
  let agreed = 0
  for (const observation of test) {
    const memorised = byFragments.get(observation.fragments)
    const prediction = memorised === undefined ? fallback : majority(memorised)
    if (prediction === observation.label) agreed += 1
  }
  return {
    train: train.length,
    test: test.length,
    agreed,
    rate: test.length === 0 ? 0 : agreed / test.length,
  }
}

/**
 * Withhold exact duplicates before a split.
 *
 * A duplicate is one observation, not two votes. Two answers to the same key are
 * the same question on the same evidence, so they collapse to one; two answers
 * over the same fragment set are the same evidence, so the later ones are
 * withheld and counted rather than silently dropped.
 */
export const withholdDuplicates = (
  observations: ReadonlyArray<Observation>,
): {
  readonly observations: ReadonlyArray<Observation>
  readonly collapsed: number
  readonly withheld: number
} => {
  const byKey = new Map<string, Observation>()
  let collapsed = 0
  for (const observation of observations) {
    if (byKey.has(observation.key)) {
      collapsed += 1
      continue
    }
    byKey.set(observation.key, observation)
  }
  const seen = new Set<string>()
  const kept: Array<Observation> = []
  let withheld = 0
  for (const observation of byKey.values()) {
    if (seen.has(observation.fragments)) {
      withheld += 1
      continue
    }
    seen.add(observation.fragments)
    kept.push(observation)
  }
  return { observations: kept, collapsed, withheld }
}

/**
 * Measure a corpus both ways, which is the whole of rung 0.
 *
 * `byAtom` is the old number: partitioning on the candidate's own name lets the
 * same evidence sit on both sides. `byKey` partitions on the decision cache key
 * and withholds exact duplicates first. They are reported side by side; a number
 * that collapses under dedupe is the finding, not a regression.
 */
export const splitReport = (observations: ReadonlyArray<Observation>): SplitReport => {
  const atoms = partition(observations, (observation) => observation.atom)
  const deduped = withholdDuplicates(observations)
  const keys = partition(deduped.observations, (observation) => observation.key)
  return {
    observations: observations.length,
    collapsed: deduped.collapsed,
    withheld: deduped.withheld,
    byAtom: agreement(atoms.train, atoms.test),
    byKey: agreement(keys.train, keys.test),
  }
}
