/**
 * decodeUnknownOption collapses every schema mismatch into None, discarding
 * the issue tree that explains why decoding failed. Prefer adapters that keep
 * the issues: SchemaParser.decodeUnknownResult for sync cores,
 * decodeUnknownEffect on the Effect channel.
 */
export declare const noDecodeUnknownOptionRule: import("@oxlint/plugins").Rule;
