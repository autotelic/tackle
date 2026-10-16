import type { ESTree } from "@oxlint/plugins";

import { isNode } from "./is-node.ts";
import { readField } from "./structural.ts";

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
export function childNodes(node: ESTree.Node): Array<ESTree.Node> {
	const children: Array<ESTree.Node> = [];
	for (const key of Object.keys(node)) {
		if (key === "parent" || key === "loc" || key === "range") continue;
		const value = readField(node, key);
		const candidates = Array.isArray(value) ? value : [value];
		for (const candidate of candidates) {
			if (isNode(candidate)) children.push(candidate);
		}
	}
	return children;
}
