import type { ESTree } from "@oxlint/plugins";
/**
 * Whether a function is a pure alias: it returns a single call that forwards
 * each of its parameters verbatim (a generator may delegate-yield such a call).
 * Anything else raises the level of abstraction and earns its name.
 *
 * @param {ESTree.Node} fn - The function-like node to inspect.
 * @returns {boolean} True when the function is dead indirection.
 */
export declare function isTrivialForwarder(fn: ESTree.Node): boolean;
/**
 * Top-level privates referenced exactly once are only worth inlining when they
 * are pure aliases (they forward their inputs verbatim to another call). A
 * single-use helper that earns its name by raising the level of abstraction is
 * kept: the document argues for factoring proactively, even at n=1.
 */
export declare const noSingleUsePrivateFunctionsRule: import("@oxlint/plugins").Rule;
