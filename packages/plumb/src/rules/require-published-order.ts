import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/** True for the numeric ordering sentinels -1, 0 and 1 in a type position.
 *
 * @param {ESTree.TSType} type - The union constituent to inspect.
 * @returns {boolean} True when the type is one of the sentinel literals.
 */
function isSentinelLiteral(type: ESTree.TSType): boolean {
	if (type.type !== "TSLiteralType") return false;
	const literal = type.literal;
	if (literal.type === "UnaryExpression") {
		return (
			literal.operator === "-" &&
			literal.argument.type === "Literal" &&
			literal.argument.value === 1
		);
	}
	return literal.type === "Literal" && (literal.value === 0 || literal.value === 1);
}

/** True for a reference to Effect's Ordering (or its -1 | 0 | 1 spelling).
 *
 * @param {ESTree.TSType} type - The annotation to inspect.
 * @returns {boolean} True when the type names Ordering.
 */
function isOrderingReference(type: ESTree.TSType): boolean {
	if (type.type !== "TSTypeReference") return false;
	const name = type.typeName;
	if (name.type === "Identifier") return name.name === "Ordering";
	return (
		name.type === "TSQualifiedName" &&
		name.left.type === "Identifier" &&
		name.left.name === "Ordering" &&
		name.right.type === "Identifier" &&
		name.right.name === "Ordering"
	);
}

function returnsComparatorOrdering(
	returnType: ESTree.TSTypeAnnotation | null | undefined,
): boolean {
	if (returnType === null || returnType === undefined) return false;
	const annotation = returnType.typeAnnotation;
	if (annotation.type === "TSUnionType") return annotation.types.every(isSentinelLiteral);
	return isOrderingReference(annotation);
}

/** A module exporting comparators must publish a named Order built from them. */
export const requirePublishedOrderRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require modules that export comparators to publish a named Order (Order.make) so call sites compose through one total order instead of hand-rolling comparisons.",
		},
		messages: {
			missingPublishedOrder:
				"`{{name}}` exposes an ordering but the module publishes no named order. Export `export const Order = Order.make({{name}})` so comparisons compose through one total order.",
		},
	},
	createOnce(context) {
		return {
			Program(node) {
				let hasPublishedOrder = false;
				const comparators: Array<{ name: string; node: ESTree.Node }> = [];
				for (const statement of node.body) {
					const declaration =
						statement.type === "ExportNamedDeclaration" ||
						statement.type === "ExportDefaultDeclaration"
							? (statement.declaration ?? null)
							: statement;
					if (declaration?.type === "VariableDeclaration") {
						for (const declarator of declaration.declarations) {
							if (declarator.id.type !== "Identifier") continue;
							const name = declarator.id.name;
							if (name === "Order") hasPublishedOrder = true;
							if (!/^compare/u.test(name)) continue;
							const init = declarator.init;
							if (
								(init?.type === "ArrowFunctionExpression" ||
									init?.type === "FunctionExpression") &&
								returnsComparatorOrdering(init.returnType)
							) {
								comparators.push({ name, node: declarator.id });
							}
						}
					}
					if (declaration?.type === "FunctionDeclaration" && declaration.id !== null) {
						const name = declaration.id.name;
						if (!/^compare/u.test(name)) continue;
						if (returnsComparatorOrdering(declaration.returnType)) {
							comparators.push({ name, node: declaration.id });
						}
					}
				}
				if (hasPublishedOrder) return;
				for (const comparator of comparators) {
					context.report({
						node: comparator.node,
						messageId: "missingPublishedOrder",
						data: { name: comparator.name },
					});
				}
			},
		};
	},
});
