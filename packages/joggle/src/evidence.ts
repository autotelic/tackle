import type { Unit } from "./workspace.ts"

/*
 * The evidence catalogue for `joggle/underused-primitive`.
 *
 * One entry per syntactic shape, and the shapes are the whole classification. An
 * earlier version cut each matched site into a hand-named sub-kind (`epoch
 * conversion`, `round interval`, ...), which fragmented one capability into
 * singletons: the ground truth in this repository is 122 round-millisecond
 * literals, 26 conversions and 20 clock subtractions, and none of the resulting
 * sub-groups cleared the three-site bar. The candidate is (kind), not (kind,
 * invented label); coherence comes from the sample the judgement is shown.
 *
 * The signal is an ABSENCE, so `matches` has to be cheap and generous. It looks
 * for the shape of hand-rolled work, not for a library's spelling.
 */

/** One family of exports that does the same job as the evidence it is compared with. */
export interface EvidenceKind {
  /** The stable id of the shape: one candidate per kind. */
  readonly kind:
    | "round-millisecond"
    | "millisecond-conversion"
    | "clock-arithmetic"
    | "tagged-error"
  /** How the kind reads in a sentence: "3 declarations do Date.now() arithmetic". */
  readonly description: string
  /** Export-name families that would already supply this capability, best first. */
  readonly families: ReadonlyArray<string>
  /** The syntactic shape a declaration carries, or false when it carries none. */
  readonly matches: (unit: Unit) => boolean
}

const ROUND_MILLISECOND = /(?<![\w.])(?:1|5|30|60|300|600|900|1800|3600)_?000(?![\w.])/u
const MILLISECOND_CONVERSION = /(?<!\w)[*/]\s*1_?000(?![\d.])/u
const DATE_NOW_ARITHMETIC = /Date\.now\(\)\s*(?:[-+*/]|&&|\|\|)/u
const CLASS_EXTENDS_ERROR = /\bclass\s+[A-Za-z_$][\w$]*\s+extends\s+Error\b/u
const TAGGED_MEMBER = /\b_tag\s*\??\s*:/u

/**
 * A round millisecond literal: `60_000`, `1_000`, `1_800_000`.
 *
 * The literal alone is the evidence. A walk-limit object and a retry delay are
 * the same hand-rolled unit, and requiring time arithmetic beside it only moved
 * the measurement away from the ground truth.
 */
const roundMillisecondKind: EvidenceKind = {
  kind: "round-millisecond",
  description: "round millisecond literals",
  families: ["Duration", "DateTime", "Clock"],
  matches: (unit) => ROUND_MILLISECOND.test(unit.text),
}

/**
 * A conversion between milliseconds and a human unit, in either direction.
 *
 * `millis / 1_000` and `seconds * 1_000` are the same missing capability read
 * from two sides; splitting them by direction is the sub-kind classification
 * that hid the capability.
 */
const millisecondConversionKind: EvidenceKind = {
  kind: "millisecond-conversion",
  description: "millisecond conversion",
  families: ["Duration", "DateTime", "Clock"],
  matches: (unit) => MILLISECOND_CONVERSION.test(unit.text),
}

/** Arithmetic on a clock reading: elapsed time, deadlines, skewed stamps. */
const clockArithmeticKind: EvidenceKind = {
  kind: "clock-arithmetic",
  description: "Date.now() arithmetic",
  families: ["Clock", "DateTime", "Duration"],
  matches: (unit) => DATE_NOW_ARITHMETIC.test(unit.text),
}

/**
 * An error declared by hand where `Data.TaggedError` already supplies the shape.
 *
 * `class X extends Error` and a type carrying `_tag` are the same concept spelled
 * two ways: a failure kind that callers can match. TaggedError replaces the
 * constructor and `_tag` boilerplate, so this is the absence the rule can point at
 * without having to believe Duration removes a literal.
 */
const taggedErrorKind: EvidenceKind = {
  kind: "tagged-error",
  description: "tagged errors",
  families: ["TaggedError"],
  matches: (unit) =>
    CLASS_EXTENDS_ERROR.test(unit.text) ||
    ((unit.kind === "interface" || unit.kind === "type") && TAGGED_MEMBER.test(unit.text)),
}

/** Every evidence kind this version of the rule reads. */
export const evidenceKinds: ReadonlyArray<EvidenceKind> = [
  roundMillisecondKind,
  millisecondConversionKind,
  clockArithmeticKind,
  taggedErrorKind,
]
