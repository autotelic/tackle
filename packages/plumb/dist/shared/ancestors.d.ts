import type { ESTree, SourceCode } from "@oxlint/plugins";
/**
 * Ancestor chain accessor returning oxlint's native order: outermost-first
 * (Program at index 0, immediate parent last). Reverse it to walk outward
 * from a node.
 *
 * Oxlint types `getAncestors` as returning an opaque span-only `Node`, not
 * the exported ESTree union; recover that union once here.
 *
 * Oxlint's `sourceCode.getAncestors` returns an internal Node type rather than
 * the exported ESTree union; recover the union once here so rule code can
 * narrow on `type` discriminants without per-site casts.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The node whose ancestor chain is requested.
 * @returns {ReadonlyArray<ESTree.Node>} Nearest-first ancestor chain.
 */
export declare function ancestorsOf(sourceCode: SourceCode, node: ESTree.Node): ReadonlyArray<ESTree.Node>;
