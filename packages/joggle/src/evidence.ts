import type { Unit } from "./workspace.ts"

/*
 * The evidence catalogue for `joggle/underused-primitive`.
 *
 * ONE entry, because one entry has produced a true finding here.
 *
 * The first version carried three duration shapes -- round millisecond literals,
 * millisecond conversions, and `Date.now()` arithmetic -- on the theory that
 * `Duration` replaces them. It does not, and the model said so every time it was
 * asked: `Duration` represents a length of time, it does not remove a literal, and
 * `Duration.millis(60_000)` is longer than `60_000`. Three passes tuned a
 * hypothesis that could not pay off. Those kinds are deleted rather than left in
 * the catalogue "in case"; an entry that cannot produce a true finding is a
 * false-positive generator with a budget.
 *
 * What survives is the shape where the export genuinely replaces the code. A
 * failure kind hand-rolled as `class X extends Error` (or a type carrying `_tag`)
 * is the same concept Effect spells `Data.TaggedError`: the export supplies the
 * constructor and the `_tag` plumbing, so adopting it deletes code instead of
 * rewrapping it.
 */

/** One family of exports that does the same job as the evidence it is compared with. */
export interface EvidenceKind {
  /** The stable id of the shape: one candidate per kind. */
  readonly kind: "tagged-error"
  /** How the kind reads in a sentence. */
  readonly description: string
  /** Export-name families that would already supply this capability, best first. */
  readonly families: ReadonlyArray<string>
  /** The syntactic shape a declaration carries, or false when it carries none. */
  readonly matches: (unit: Unit) => boolean
}

/** A class whose superclass is `Error`: the constructor and `name` are hand-written. */
const CLASS_EXTENDS_ERROR = /class\s+\w+\s+extends\s+Error\b/u

/** A failure type that carries its own `_tag` instead of deriving one from a tag. */
const TAGGED_MEMBER = /_tag\s*:/u

/**
 * A hand-rolled tagged error.
 *
 * `class X extends Error` and an interface carrying `_tag` are one concept spelled
 * two ways: a failure kind callers can match on. TaggedError replaces the
 * constructor and the `_tag` boilerplate, which is what makes this the absence the
 * rule can point at without having to believe an export removes a literal.
 */
export const taggedErrorKind: EvidenceKind = {
  kind: "tagged-error",
  description: "tagged errors",
  families: ["TaggedError"],
  matches: (unit) =>
    CLASS_EXTENDS_ERROR.test(unit.text) ||
    ((unit.kind === "interface" || unit.kind === "type") && TAGGED_MEMBER.test(unit.text)),
}

/** Every evidence kind this version of the rule reads. One, because one is proven. */
export const evidenceKinds: ReadonlyArray<EvidenceKind> = [taggedErrorKind]
