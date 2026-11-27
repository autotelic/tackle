import type { Unit } from "./workspace.ts"

/*
 * The evidence catalogue for `joggle/underused-primitive`.
 *
 * One entry, for one reason: a rule that recognises everything recognises nothing. The
 * kind names the capability the evidence is about, the families are the dependency
 * exports that would supply it, and `clusterOf` is the only pattern this pass reads.
 *
 * The signal is an ABSENCE, so `clusterOf` has to be cheap and generous. It looks for
 * the shape of hand-rolled duration arithmetic, not for a particular library's spelling.
 * It returns the shape of the arithmetic itself, because a pool of every `Date.now()`
 * subtraction beside every millisecond conversion is not one capability: the model shown
 * that grab bag correctly answers that the export does not do all of it.
 */

/** One family of exports that does the same job as the evidence it is compared with. */
export interface EvidenceKind {
  readonly kind: "duration"
  /** Export-name families that would already supply this capability. */
  readonly families: ReadonlyArray<string>
  /** The coherent arithmetic a declaration carries, or undefined when it carries none. */
  readonly clusterOf: (unit: Unit) => string | undefined
}

const ROUND_MILLISECOND = /(?<![\w.])(?:1|5|30|60|300|600|900|1800|3600)_?000(?![\w.])/u
const DIVISION_BY_MILLIS = /(?<!\w)\/\s*1_?000(?!\d)/u
const MULTIPLICATION_BY_MILLIS = /(?<!\w)\*\s*1_?000(?!\d)/u
const DATE_NOW_ARITHMETIC = /Date\.now\(\)\s*(?:[-+*/]|&&|\|\|)/u

/**
 * Duration arithmetic, split into the shapes it actually takes.
 *
 * A clock reading and adjustment is a different capability from a round interval
 * literal, which is a different capability again from converting milliseconds to a
 * human unit. Direction matters: `millis / 1_000` is a conversion Duration supplies,
 * while `seconds * 1_000` beside it is the reverse and is not the same arithmetic.
 * Precision matters too: a bare round literal is only a duration when it is used in
 * time math, so an object of token and walk limits is not evidence.
 */
export const durationKind: EvidenceKind = {
  kind: "duration",
  families: ["Duration", "Clock", "DateTime"],
  clusterOf: (unit) => {
    if (DATE_NOW_ARITHMETIC.test(unit.text)) return "clock-arithmetic"
    if (DIVISION_BY_MILLIS.test(unit.text)) return "millisecond-conversion"
    if (MULTIPLICATION_BY_MILLIS.test(unit.text)) return "epoch-conversion"
    if (ROUND_MILLISECOND.test(unit.text) && /(?:[-+>]=?|return)\s*[\w(]/u.test(unit.text)) {
      return "round-interval"
    }
    return undefined
  },
}

/** Every evidence kind this version of the rule reads. One, on purpose. */
export const evidenceKinds: ReadonlyArray<EvidenceKind> = [durationKind]
