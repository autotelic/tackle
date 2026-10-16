import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/** Whether the callee accesses `.property` or `.asyncProperty`.
 * @param {ESTree.CallExpression["callee"]} callee - The callee expression of a call being inspected.
 * @returns {boolean} True when the callee is a property access matching fastcheck patterns. */
function isPropertyCall(callee: ESTree.CallExpression["callee"]): boolean {
	return (
		callee.type === "MemberExpression" &&
		callee.property.type === "Identifier" &&
		(callee.property.name === "property" || callee.property.name === "asyncProperty")
	);
}

/** fast-check scores a predicate's implicit return; expression-bodied arrows return matchers. */
export const requireFcBlockPredicateRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require fast-check property predicates to use block bodies: an expression-bodied arrow returns its last expression (often a vitest matcher object), which fast-check scores as a falsy result and fails the property.",
		},
		messages: {
			blockBody:
				"This property predicate returns its expression value, which fast-check may score as `false`. Use a block body (`=> { ...; }`) so the predicate returns void.",
		},
	},
	createOnce(context) {
		const checkArguments = (node: ESTree.CallExpression): void => {
			if (!isPropertyCall(node.callee)) return;
			for (const argument of node.arguments) {
				if (argument.type !== "ArrowFunctionExpression") continue;
				if (argument.body.type === "BlockStatement") continue;
				context.report({ node: argument, messageId: "blockBody" });
			}
		};
		return {
			CallExpression: checkArguments,
		};
	},
});
