/**
 * A function that reads or writes module state instead of taking it as a
 * parameter is dishonest: its result depends on outside context, so it is not
 * locally testable. Inject the value at the call site (the document's seed-the
 * PRNG-once, pass-it-in pattern) so the dependency is explicit in the signature.
 */
export declare const noMutableEnvironmentCaptureRule: import("@oxlint/plugins").Rule;
