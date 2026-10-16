/**
 * Hand-rolled `if (x._tag !== "...") throw new Error(...)` ladders re-implement
 * narrowing assertions per spec; a shared assertTag helper does it once, with
 * type-level narrowing.
 */
export declare const noTagLadderAssertionsRule: import("@oxlint/plugins").Rule;
