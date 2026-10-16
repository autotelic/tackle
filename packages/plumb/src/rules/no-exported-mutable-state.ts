import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const MUTATING_METHODS = new Set([
	"add",
	"clear",
	"copyWithin",
	"defineProperty",
	"delete",
	"fill",
	"pop",
	"push",
	"reverse",
	"set",
	"shift",
	"sort",
	"splice",
	"unshift",
]);

/** Root identifier of an assignment target / call receiver, if statically simple.
 *
 * @param {ESTree.Node} node - The target or receiver expression.
 * @returns {string | null} The leftmost identifier's name, or null when dynamic.
 */
function rootIdentifier(node: ESTree.Node): string | null {
	if (node.type === "Identifier") return node.name;
	if (node.type === "MemberExpression" && !node.computed) return rootIdentifier(node.object);
	if (node.type === "ParenthesizedExpression") return rootIdentifier(node.expression);
	return null;
}

/**
 * No blessed surface area: a value that escapes module scope mutably lets
 * every invariant its constructor established be broken from outside. Module
 * state must be immutable bindings over immutable structures; anything that
 * varies belongs in parameters, state objects or Effect services.
 */
export const noExportedMutableStateRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow exported let/var bindings and mutation of module-scope values; keep module state immutable so construction-time invariants can't be broken.",
		},
		messages: {
			exportedBinding:
				"`{{name}}` is exported as a mutable binding, so importers can change it under every other consumer and break whatever invariants it carried. Export a `const`.",
			moduleMutation:
				"`{{name}}` lives at module scope, so this mutation is invisible shared state across every caller: the blessed-surface-area problem. Make it local, or hold it in explicit state/service passed by parameter.",
		},
	},
	createOnce(context) {
		let topLevelNames = new Set<string>();

		function checkTarget(node: ESTree.Node): void {
			const name = rootIdentifier(node);
			if (name === null || !topLevelNames.has(name)) return;
			context.report({ node, messageId: "moduleMutation", data: { name } });
		}

		function isMutatingCall(node: ESTree.Expression): boolean {
			if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
			const property = node.callee.property;
			return property.type === "Identifier" && MUTATING_METHODS.has(property.name);
		}

		return {
			Program(node) {
				topLevelNames = new Set(
					node.body.flatMap((statement) =>
						statement.type === "VariableDeclaration"
							? statement.declarations.flatMap((declarator) =>
									declarator.id.type === "Identifier" ? [declarator.id.name] : [],
								)
							: (statement.type === "FunctionDeclaration" ||
									statement.type === "ClassDeclaration") &&
								  statement.id !== null
								? [statement.id.name]
								: [],
					),
				);
			},
			ExportNamedDeclaration(node) {
				const declaration = node.declaration;
				if (declaration === null || declaration.type !== "VariableDeclaration") return;
				if (declaration.kind === "const") return;
				for (const declarator of declaration.declarations) {
					if (declarator.id.type !== "Identifier") continue;
					context.report({
						node,
						messageId: "exportedBinding",
						data: { name: declarator.id.name },
					});
				}
			},
			AssignmentExpression(node) {
				checkTarget(node.left);
			},
			UpdateExpression(node) {
				checkTarget(node.argument);
			},
			CallExpression(node) {
				if (!isMutatingCall(node)) return;
				if (node.callee.type !== "MemberExpression") return;
				checkTarget(node.callee.object);
			},
		};
	},
});
