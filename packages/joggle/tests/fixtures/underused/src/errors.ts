/**
 * Errors spelled by hand, where `Data.TaggedError` already supplies the shape.
 *
 * Two classes and one data type carrying the same `_tag` discriminant: one
 * concept with two spellings.
 */
export class NotFoundError extends Error {}

export class ConflictError extends Error {
  readonly detail = "conflict"
}

export type Forbidden = {
  readonly _tag: "Forbidden"
  readonly reason: string
}
