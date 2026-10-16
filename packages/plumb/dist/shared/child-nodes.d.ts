import type { ESTree } from "@oxlint/plugins";
/**
 * Child nodes of an ESTree node via reflection over its fields.
 *
 * SAFETY: node fields are owned by the AST grammar (see NodeFieldValue); the
 * object/array discrimination here is the field-to-child boundary. Prefer
 * declared visitors; use this only for custom descent orders.
 *
 * @param {ESTree.Node} node - The parent AST node.
 * @returns {Array<ESTree.Node>} Direct child nodes, in field order.
 */
export declare function childNodes(node: ESTree.Node): Array<ESTree.Node>;
