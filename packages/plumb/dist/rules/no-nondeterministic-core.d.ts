/**
 * Canonical form: identical inputs must produce identical outputs. Time and
 * randomness are boundary inputs: capture them once at the edge and pass
 * them in, so cores stay reproducible and their serialisations stable.
 */
export declare const noNondeterministicCoreRule: import("@oxlint/plugins").Rule;
