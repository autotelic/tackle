/**
 * JSON.parse throws a raw SyntaxError defect. Inside an Effect/Either/Option
 * channel that bypasses the typed failure path unless explicitly guarded.
 */
export declare const noUnguardedJsonParseRule: import("@oxlint/plugins").Rule;
