/**
 * Guarded operations must surface failure reasons as tagged MoneyError values
 * through the Effect error channel, not as bare Option.None which conflates
 * every possible why into one silent absence.
 */
export declare const guardedOpMustReturnEffectRule: import("@oxlint/plugins").Rule;
