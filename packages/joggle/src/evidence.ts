import type { Unit } from "./workspace.ts"

/*
 * The evidence catalogue for `joggle/underused-primitive`.
 *
 * One entry, for one reason: a rule that recognises everything recognises nothing. The
 * kind names the capability the evidence is about, the families are the dependency
 * exports that would supply it, and `matches` is the only pattern this pass reads.
 *
 * The signal is an ABSENCE, so `matches` has to be cheap and generous. It looks for the
 * shape of hand-rolled duration arithmetic, not for a particular library's spelling.
 */

/** One family of exports that does the same job as the evidence it is compared with. */
export interface EvidenceKind {
  readonly kind: "duration"
  /** Export-name families that would already supply this capability. */
  readonly families: ReadonlyArray<string>
  /** Whether a declaration's body carries this evidence. */
  readonly matches: (unit: Unit) => boolean
}

const ROUND_MILLISECOND = /(?<![\w.])(?:1|5|30|60|300|600|900|1800|3600)_?000(?![\w.])/u
const MILLISECOND_CONVERSION = /(?:\*|\/)\s*1_?000(?![\w.])/u
const DATE_NOW_ARITHMETIC = /Date\.now\(\)\s*(?:[-+*/]|&&|\|\|)/u

/** Duration arithmetic: the clock read and adjusted, or a round millisecond literal. */
export const durationKind: EvidenceKind = {
  kind: "duration",
  families: ["Duration", "Clock", "DateTime"],
  matches: (unit) =>
    DATE_NOW_ARITHMETIC.test(unit.text) ||
    ROUND_MILLISECOND.test(unit.text) ||
    MILLISECOND_CONVERSION.test(unit.text),
}

/** Every evidence kind this version of the rule reads. One, on purpose. */
export const evidenceKinds: ReadonlyArray<EvidenceKind> = [durationKind]
