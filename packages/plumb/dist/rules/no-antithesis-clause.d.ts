/** The two-clause corrections: "X is not A. It is B." and "not A, but B".
 *
 * The first clause only helps a reader who already believed A, and a reader who
 * did not has to hold a wrong idea for a sentence before it is corrected.
 */
export declare const CORRECTIONS: ReadonlyArray<RegExp>;
/** A sentence that corrects a belief the reader was never shown to hold. */
export declare const noAntithesisClauseRule: import("@oxlint/plugins").Rule;
