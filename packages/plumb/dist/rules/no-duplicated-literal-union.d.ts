/**
 * One fact, one place: a set of variants declared twice drifts the moment
 * someone adds a member to one copy. Declare each variant set once and
 * derive every use from it.
 */
export declare const noDuplicatedLiteralUnionRule: import("@oxlint/plugins").Rule;
