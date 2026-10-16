import type { ESTree } from "@oxlint/plugins";
type VisitorKeys = Readonly<Record<string, readonly string[]>>;
/**
 * Collect type binders that are in scope at a node and can shadow module aliases.
 *
 * @param {ESTree.Node} node - The node whose lexical scope is being resolved.
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain of `node`.
 * @param {VisitorKeys} visitorKeys - Grammar keys used to descend conditional types.
 * @returns {ReadonlySet<string>} Names of in-scope type binders.
 */
export declare function lexicalTypeParameterNames(node: ESTree.Node, ancestors: ReadonlyArray<ESTree.Node>, visitorKeys: VisitorKeys): ReadonlySet<string>;
export {};
