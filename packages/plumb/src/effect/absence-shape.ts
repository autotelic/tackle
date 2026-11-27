/**
 * The one shape for "this operation may have no answer": an Either whose Left
 * carries a tagged reason.
 *
 * `guarded-op-must-return-option` (T | undefined) and `guarded-op-must-return-effect`
 * (Option<T>) police the same question from opposite ends. They agree only while
 * both name this shape, so the vocabulary lives here once instead of each message
 * explaining the other. absence-shape-matrix.test.ts holds them to it.
 */
export const ABSENCE_TYPE = "Either<T, TaggedReason>";

/** The reason an absence must carry. */
export const TAGGED_REASON = "a Schema.TaggedError reason";

/** Why Option is not the answer. */
export const OPTION_HIDES_REASON = "`Option<T>` hides why the value is absent";
