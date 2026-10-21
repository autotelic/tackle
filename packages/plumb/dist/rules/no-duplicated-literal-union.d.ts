import type { ESTree } from "@oxlint/plugins";
/** Sorted string-literal members of a union annotation, or null if it isn't one.
 *
 * @param {ESTree.TSType} annotation - The annotation to inspect.
 * @returns {string[] | null} Sorted literal members, or null when not a literal union.
 */
export declare function literalUnionKey(annotation: ESTree.TSType): string[] | null;
/**
 * One fact, one place: a set of variants declared twice drifts the moment
 * someone adds a member to one copy. Declare each variant set once and
 * derive every use from it.
 */
export declare const noDuplicatedLiteralUnionRule: import("@oxlint/plugins").Rule;
