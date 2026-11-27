import type { Unit } from "./workspace.ts"

/*
 * The evidence catalogue for `joggle/underused-primitive`.
 *
 * A kind survives here only when adopting an export genuinely deletes code. The
 * first version carried three duration shapes; `Duration` represents a length of
 * time but does not remove a literal, so those kinds could never produce a true
 * finding and are deleted rather than kept "in case".
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

/** A hand-rolled tagged error, which `Data.TaggedError` already spells. */
const taggedErrorKind: EvidenceKind = {
  kind: "tagged-error",
  description: "tagged errors",
  families: ["TaggedError"],
  matches: (unit) =>
    CLASS_EXTENDS_ERROR.test(unit.text) ||
    ((unit.kind === "interface" || unit.kind === "type") && TAGGED_MEMBER.test(unit.text)),
}

/** Every evidence kind this version of the rule reads. */
export const evidenceKinds: ReadonlyArray<EvidenceKind> = [taggedErrorKind]
