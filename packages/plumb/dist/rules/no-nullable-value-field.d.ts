/**
 * Whether a constructor chain admits an absent value.
 *
 * @param {ReadonlyArray<string>} names - The names in the field's chain.
 * @returns {boolean} True when one of them makes the field absent.
 */
export declare function hasAbsence(names: ReadonlyArray<string>): boolean;
/**
 * A value is certain, or it is not a value.
 *
 * Nullability from a `left join` is a retrieval artifact. When it becomes a
 * field of the concept, the concept starts saying the business is unsure about
 * something it knows. The partiality belongs in the derivation that read the
 * row, and the exception ("this field is absent by nature") needs a comment.
 */
export declare const noNullableValueFieldRule: import("@oxlint/plugins").Rule;
