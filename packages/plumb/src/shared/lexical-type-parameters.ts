import type { ESTree } from "@oxlint/plugins";
import { isNode } from "./is-node.ts";
import type { NodeFieldValue } from "../shared/structural.ts";
import { readField } from "../shared/structural.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

function collectInferTypeParameterNames(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
	names: Set<string>,
): void {
	if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
	for (const key of visitorKeys[node.type] ?? []) {
		const value = readField(node, key);
		if (isNode(value)) {
			collectInferTypeParameterNames(value, visitorKeys, names);
			continue;
		}
		if (!Array.isArray(value)) continue;
		for (const child of value) {
			if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
		}
	}
}

/**
 * Collect type binders that are in scope at a node and can shadow module aliases.
 *
 * @param {ESTree.Node} node - The node whose lexical scope is being resolved.
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain of `node`.
 * @param {VisitorKeys} visitorKeys - Grammar keys used to descend conditional types.
 * @returns {ReadonlySet<string>} Names of in-scope type binders.
 */
export function lexicalTypeParameterNames(
	node: ESTree.Node,
	ancestors: ReadonlyArray<ESTree.Node>,
	visitorKeys: VisitorKeys,
): ReadonlySet<string> {
	const names = new Set<string>();
	const chain: Array<ESTree.Node> = [node, ...[...ancestors].reverse()];
	for (let index = 1; index < chain.length; index += 1) {
		const current = chain[index]!;
		if (current.type === "Program") break;
		const descendant = chain[index - 1]!;
		if ("typeParameters" in current) {
			for (const parameter of current.typeParameters?.params ?? []) {
				names.add(parameter.name.name);
			}
		}
		if (
			current.type === "TSMappedType" &&
			(descendant === current.nameType || descendant === current.typeAnnotation)
		) {
			names.add(current.key.name);
		}
		if (current.type === "TSConditionalType" && descendant === current.trueType) {
			collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
		}
	}
	return names;
}
