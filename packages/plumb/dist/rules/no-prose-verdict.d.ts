/** The closers that grade the material instead of adding a fact.
 *
 * Each one ends a paragraph by asserting that the paragraph mattered. Deleting the
 * sentence loses no information, which is the test the rule applies.
 */
export declare const CLOSERS: ReadonlyArray<RegExp>;
/** A comment or a message that asserts its own importance instead of stating a fact. */
export declare const noProseVerdictRule: import("@oxlint/plugins").Rule;
