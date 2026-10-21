import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { isRecordObject, isString } from "../shared/structural.ts";

/** Sorted string-literal members of a union annotation, or null if it isn't one.
 *
 * @param {ESTree.TSType} annotation - The annotation to inspect.
 * @returns {string[] | null} Sorted literal members, or null when not a literal union.
 */
export function literalUnionKey(annotation: ESTree.TSType): string[] | null {
	const types = annotation.type === "TSUnionType" ? annotation.types : [annotation];
	const literals: string[] = [];
	for (const member of types) {
		if (member.type !== "TSLiteralType" || member.literal.type !== "Literal") return null;
		if (!isString(member.literal.value)) return null;
		literals.push(member.literal.value);
	}
	return [...literals].sort((a, b) => a.localeCompare(b));
}

/**
 * One fact, one place: a set of variants declared twice drifts the moment
 * someone adds a member to one copy. Declare each variant set once and
 * derive every use from it.
 */
export const noDuplicatedLiteralUnionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow string-literal unions whose exact member set is declared by more than one alias in a file; declare the variant set once.",
		},
		messages: {
			duplicateUnion:
				"`{{second}}` declares exactly the variant set of `{{first}}`: two sources of truth that will drift when a member is added to one. Export `{{first}}` and reuse it (or rename if coincidental).",
		},
	},
	createOnce(context) {
		const seen = new Map<string, string>();
		const duplicates = new Map<string, { node: ESTree.Node; name: string; first: string }>();

		return {
			before() {
				seen.clear();
				duplicates.clear();
			},
			TSTypeAliasDeclaration(node) {
				const key = literalUnionKey(node.typeAnnotation);
				if (key === null) return;
				const joined = key.join("\u0000");
				const first = seen.get(joined);
				if (first === undefined) {
					seen.set(joined, node.id.name);
					return;
				}
				duplicates.set(`${joined}\u0000${node.id.name}`, { node, name: node.id.name, first });
			},
			"Program:exit"() {
				for (const duplicate of duplicates.values()) {
					context.report({
						node: duplicate.node,
						messageId: "duplicateUnion",
						data: { second: duplicate.name, first: duplicate.first },
					});
				}
			},
		};
	},
});
