import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const STRUCT_PROPERTIES = new Set(["Struct", "TaggedStruct"]);

/**
 * Whether an expression calls `Schema.struct`/`Schema.fields` on a schema-ish object.
 *
 * @param {ESTree.Expression | ESTree.SpreadElement | null} expression - The candidate call expression.
 * @returns {boolean} True when the expression is a schema struct-style call.
 */
function isSchemaStructCall(expression: ESTree.Expression | ESTree.SpreadElement | null): boolean {
	if (expression === null || expression.type !== "CallExpression") return false;
	const callee = expression.callee;
	if (callee.type !== "MemberExpression" || callee.computed) return false;
	if (callee.property.type !== "Identifier" || !STRUCT_PROPERTIES.has(callee.property.name)) return false;
	const object = callee.object;
	return (
		object.type === "Identifier" && /schema$/iu.test(object.name)
	);
}

/** Fold a declared name to its stem so `RationalSchema`/`rational` and `rationalSchema` collide.
 *
 * @param {string} name - The declared name to fold.
 * @returns {string} The case-insensitive comparison stem.
 */
function normaliseName(name: string): string {
	const folded = name.replaceAll(/[^a-zA-Z0-9]/gu, "").toLowerCase();
	return folded.endsWith("schema") ? folded.slice(0, -6) : folded;
}

/**
 * Single source of truth: once a Schema exists, it is the canonical shape.
 * A hand-written twin type drifts from it silently: derive the static side
 * with `Schema.Type<typeof x>` so identical data can only have one declared
 * form.
 */
export const requireSchemaTypeDerivationRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require static types paired with an Effect Schema to be derived via Schema.Type<typeof schema> instead of re-declaring the shape by hand.",
		},
		messages: {
			handWrittenTwin:
				"`{{name}}` re-declares the shape of `{{schema}}` by hand, giving the data two sources of truth that drift. Derive it as `Schema.Type<typeof {{schema}}>` (or rename if unrelated).",
		},
	},
	createOnce(context) {
		const schemas = new Map<string, string>();
		const typeAliases = new Map<string, { node: ESTree.Node; name: string }>();

		return {
			VariableDeclarator(node) {
				if (node.id.type !== "Identifier" || node.init === null || node.init === undefined) return;
				if (!isSchemaStructCall(node.init)) return;
				schemas.set(normaliseName(node.id.name), node.id.name);
			},
			TSTypeAliasDeclaration(node) {
				if (node.typeAnnotation.type !== "TSTypeLiteral") return;
				typeAliases.set(normaliseName(node.id.name), { node, name: node.id.name });
			},
			TSInterfaceDeclaration(node) {
				if (node.id.type !== "Identifier") return;
				typeAliases.set(normaliseName(node.id.name), { node, name: node.id.name });
			},
			"Program:exit"() {
				for (const [stem, alias] of typeAliases) {
					const schema = schemas.get(stem);
					if (schema === undefined) continue;
					context.report({
						node: alias.node,
						messageId: "handWrittenTwin",
						data: { name: alias.name, schema },
					});
				}
			},
		};
	},
});
