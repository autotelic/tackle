import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { firstOptionRecord } from "../../shared/rule-options.ts";
import { isString } from "../../shared/structural.ts";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/test\//u;

/** Object names that suggest external input: request bodies, params, etc. */
const DEFAULT_INPUT_NAMES: ReadonlySet<string> = new Set([
	"body",
	"params",
	"query",
	"data",
	"input",
	"payload",
]);

interface Options {
	readonly allow?: ReadonlyArray<string>;
}

/**
 * Whether a node is a literal value (boolean, string, number, null).
 * @param {ESTree.Node} node - The node to test.
 * @returns {boolean} True when the node is a literal.
 */
function isLiteral(node: ESTree.Node): boolean {
	return node.type === "Literal";
}

/**
 * The display string for a literal value.
 * @param {ESTree.Expression} node - The literal node.
 * @returns {string} The display string.
 */
function literalDisplay(node: ESTree.Expression): string {
	if (node.type === "Literal" && node.value === null) return "null";
	if (node.type === "Literal") return String(node.value);
	if (node.type === "UnaryExpression" && node.argument.type === "Literal") return String(node.argument.value);
	return "unknown";
}

/**
 * Disallow using nullish coalescing (`??`) with a literal default on a
 * member expression of an external input object. In partial updates
 * (PATCH/PUT), a field might be intentionally absent; `?? false` conflates
 * "absent" with "explicitly false", so you can't distinguish "don't change
 * this field" from "set it to false".
 *
 * This pattern re-invent's Effect's Schema: it manually detects absence where
 * `Schema.optional` / `Schema.nullable` would distinguish absent from falsy
 * with full type safety. The schema also centralizes the rule so it can't
 * drift between the API and the UI.
 */
export const noNullishDefaultOnPartialInputRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow nullish coalescing (??) with literal defaults on member expressions of external input objects; this conflates 'absent' with 'falsy' in partial updates and re-invent's Effect's Schema. Use Schema.optional / Schema.nullable to distinguish absent from falsy.",
		},
		messages: {
			nullishDefaultOnPartialInput:
				"`?? {{default}}` on `{{object}}.{{property}}` conflates 'absent' with '{{default}}' in partial updates and re-invent's Effect's Schema. Use `Schema.optional` / `Schema.nullable` to distinguish absent from falsy with full type safety.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allow: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allow: [] }],
	},
	createOnce(context) {
		const option = firstOptionRecord(context.options);
		const allowed: ReadonlySet<string> = new Set(
			Array.isArray(option.allow) ? option.allow.filter(isString) : [],
		);
		const inputNames = new Set(DEFAULT_INPUT_NAMES);
		for (const name of allowed) inputNames.delete(name);
		return {
			before() {
				if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			LogicalExpression(node) {
				if (node.operator !== "??") return;
				if (node.left.type !== "MemberExpression") return;
				if (!isLiteral(node.right)) return;
				const member = node.left;
				if (member.object.type !== "Identifier") return;
				const objectName = member.object.name;
				if (!inputNames.has(objectName)) return;
				const propertyName =
					!member.computed && member.property.type === "Identifier"
						? member.property.name
						: undefined;
				if (propertyName === undefined) return;
				context.report({
					node,
					messageId: "nullishDefaultOnPartialInput",
					data: {
						default: literalDisplay(node.right),
						object: objectName,
						property: propertyName,
					},
				});
			},
		};
	},
});
