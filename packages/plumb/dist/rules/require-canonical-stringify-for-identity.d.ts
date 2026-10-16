/**
 * Canonical form: JSON.stringify walks insertion order, so structurally
 * equal data can serialise to different strings depending on construction
 * history. As an identity function (comparison, Map/Set key, hash input),
 * that is a false-negative machine. Only a canonical (key-sorted)
 * serializer may stand in for structural equality there.
 */
export declare const requireCanonicalStringifyForIdentityRule: import("@oxlint/plugins").Rule;
