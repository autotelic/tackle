/**
 * Guarded operations must surface failure reasons as tagged values through the
 * Effect error channel, not as bare Option.None which conflates every possible
 * why into one silent absence. Sync cores name ABSENCE_TYPE, the same spelling
 * `guarded-op-must-return-option` requires.
 */
export declare const guardedOpMustReturnEffectRule: import("@oxlint/plugins").Rule;
