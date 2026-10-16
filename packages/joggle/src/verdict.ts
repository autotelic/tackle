import type { Decision } from "effect/unstable/ai"
import type { Consistency } from "./rule.ts"

/**
 * One number per answer: the probability the rule is violated.
 *
 * abide's reduction, and the thing joggle had fifteen hand-rolled copies of.
 * Every question declares which answers mean "violated" -- a Choice names the
 * violating labels, a Noul's yes is the violation -- and this turns any answer
 * into a single probability the band, the gate and the report all read.
 *
 * A Choice is RELATIVE: its probabilities are a distribution over the labels, so
 * the violation probability is the mass on the violating ones. A Noul is
 * ABSOLUTE: `probability` is already the answer. The two are not comparable as
 * numbers (the jaggedness doc is explicit that P(noul) + P(not noul) need not be
 * 1), which is why the reduction is declared per question rather than assumed.
 */
export interface Verdict {
  /** The winning label, for a Choice. Absent for a Noul. */
  readonly label: string | undefined
  /** P(this rule is violated), however the question was phrased. */
  readonly probability: number
  /** Winner minus runner-up, for a Choice. 1 for a decision with one option. */
  readonly margin: number
  readonly confidence: number | undefined
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Reduce one answer to the probability its rule is violated.
 *
 * @param answer - the decision's answer, or undefined when the run had none.
 * @param violating - the Choice labels that mean "violated"; empty for a Noul,
 *   whose "yes" is the violation.
 * @returns the verdict, or undefined when the answer carries no label and no
 *   probability -- an unreadable answer, which every caller reports unverified.
 */
export const verdictOf = (
  answer: (Decision.Answer<Decision.Any> & Consistency) | undefined,
  violating: ReadonlyArray<string>,
): Verdict | undefined => {
  if (answer === undefined) return undefined

  // A Noul answers with a probability, and the violation is "yes".
  if ("probability" in answer) {
    // A Noul asked more than once carries the AGREEMENT across its asks, and that
    // is its margin: one yes/no has no distribution, so without the repeats the
    // probability floor was its only gate (docs/typesafe.md, self-consistency).
    // The agreement maps onto the margin's range by its distance from a coin
    // flip: every ask agreed is 1, an even split is 0.
    const agreement = answer.consistency === undefined ? undefined : clamp01(answer.consistency)
    return {
      label: undefined,
      probability: clamp01(answer.probability),
      margin: agreement === undefined ? 1 : 2 * agreement - 1,
      confidence: undefined,
    }
  }

  // A Choice picks a label and distributes the rest.
  if ("label" in answer) {
    const label = answer.label
    const probabilities = "probabilities" in answer ? answer.probabilities : {}
    const violatingSet = new Set(violating)
    // No distribution (a bare pick): the label is either violating or not.
    if (Object.keys(probabilities).length === 0) {
      return {
        label,
        probability: violatingSet.has(label) ? 1 : 0,
        margin: 1,
        confidence: "confidence" in answer ? answer.confidence : undefined,
      }
    }
    let mass = 0
    for (const [name, value] of Object.entries(probabilities)) {
      if (violatingSet.has(name)) mass += value
    }
    const ranked = Object.values(probabilities).sort((left, right) => right - left)
    const margin = ranked.length < 2 ? 1 : (ranked[0] ?? 0) - (ranked[1] ?? 0)
    return {
      label,
      probability: clamp01(mass),
      margin,
      confidence: "confidence" in answer ? answer.confidence : undefined,
    }
  }

  return undefined
}
