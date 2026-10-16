/**
 * Disallow forwarding raw error messages from caught exceptions. This pattern
 * re-invent's Effect's typed error channel: raw strings leak internal details
 * (stack traces, file paths, database errors) and lose structure so callers
 * can't match on the failure kind.
 *
 * Use Effect's `TaggedError`: a tagged class per failure kind carrying
 * structured evidence as fields, rendering its message from those fields. The
 * error then flows through Effect's typed error channel instead of being
 * stringified at every boundary.
 */
export declare const noRawErrorForwardingRule: import("@oxlint/plugins").Rule;
