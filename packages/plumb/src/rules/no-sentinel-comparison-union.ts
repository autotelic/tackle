import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { readField } from "../shared/structural.ts";
import { ancestorsOf } from "../shared/ancestors.ts";

const SENTINELS = new Set<number>([-1, 0, 1]);
const ORDERING_OPERATORS = new Set([">", "<", ">=", "<="]);

function sentinelValue(expression: ESTree.Expression): number | null {
	if (expression.type === "Literal") {
		const numeric = readField<number>(expression, "value");
		return numeric !== undefined && SENTINELS.has(numeric) ? numeric : null;
	}
	if (
		expression.type === "UnaryExpression" &&
		expression.operator === "-" &&
		expression.argument.type === "Literal" &&
		expression.argument.value === -1
	) {
		return -1;
	}
	return null;
}

/** True when every leaf of an expression tree is one of the ordering sentinels.
 * @param {ESTree.Expression} expression - Candidate expression to inspect.
 * @returns {boolean} True when the expression (or both conditional branches) are sentinels. */
function chainIsSentinel(expression: ESTree.Expression): boolean {
	if (sentinelValue(expression) !== null) return true;
	if (expression.type === "ConditionalExpression") {
		return chainIsSentinel(expression.consequent) && chainIsSentinel(expression.alternate);
	}
	return false;
}

function hasOrderingComparison(expression: ESTree.Expression): boolean {
	if (expression.type === "BinaryExpression") {
		return ORDERING_OPERATORS.has(expression.operator);
	}
	if (expression.type === "LogicalExpression") {
		return hasOrderingComparison(expression.left) || hasOrderingComparison(expression.right);
	}
	if (expression.type === "UnaryExpression") {
		return hasOrderingComparison(expression.argument);
	}
	if (expression.type === "ParenthesizedExpression") {
		return hasOrderingComparison(expression.expression);
	}
	if (expression.type === "ConditionalExpression") {
		return (
			hasOrderingComparison(expression.test) ||
			hasOrderingComparison(expression.consequent) ||
			hasOrderingComparison(expression.alternate)
		);
	}
	return false;
}

/** True when the conditional is nested under a larger sentinel chain already reported at its root.
 * @param {ESTree.ConditionalExpression} node - The conditional being checked.
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain from the traversal engine.
 * @returns {boolean} True when an enclosing conditional already forms a reported sentinel chain. */
function coveredByOuterSentinelChain(node: ESTree.ConditionalExpression, ancestors: ReadonlyArray<ESTree.Node>): boolean {
	for (let index = ancestors.length - 1; index >= 0; index--) {
		const current = ancestors[index]!;
		if (current.type === "ConditionalExpression") {
			if (chainIsSentinel(current)) return true;
		} else if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionDeclaration" ||
			current.type === "FunctionExpression" ||
			current.type === "Program"
		) {
			return false;
		}
	}
	return false;
}

function asSingleReturnSentinel(statement: ESTree.Statement): boolean {
	const target =
		statement.type === "BlockStatement" && statement.body.length === 1
			? statement.body[0] ?? statement
			: statement;
	return (
		target.type === "ReturnStatement" &&
		target.argument !== null &&
		sentinelValue(target.argument) !== null
	);
}

/** True when an if/else-if/else chain returns only ordering sentinels from every branch.
 * @param {ESTree.IfStatement} node - The root if-statement of the chain.
 * @returns {boolean} True when every branch returns a sentinel comparison. */
function ifChainIsSentinel(node: ESTree.IfStatement): boolean {
	let branch: ESTree.IfStatement | null = node;
	while (branch !== null) {
		if (!asSingleReturnSentinel(branch.consequent)) return false;
		const alternate: ESTree.Statement | null = branch.alternate;
		if (alternate === null) return false;
		if (alternate.type === "IfStatement") {
			branch = alternate;
			continue;
		}
		return asSingleReturnSentinel(alternate);
	}
	return false;
}

/** Ban hand-built -1/0/1 comparison results; ordering must go through a named order. */
export const noSentinelComparisonUnionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow hand-built -1/0/1 ordering results from comparison expressions; use a named Order/Ordering or a domain comparison instead.",
		},
		messages: {
			sentinelComparisonUnion:
				"This comparison hand-builds a -1/0/1 result. Publish a named order (Order.compare + Ordering.match) or return the compared values directly.",
		},
	},
	createOnce(context) {
		return {
			ConditionalExpression(node) {
				if (!chainIsSentinel(node)) return;
				if (coveredByOuterSentinelChain(node, ancestorsOf(context.sourceCode, node))) return;
				if (!hasOrderingComparison(node)) return;
				context.report({ node, messageId: "sentinelComparisonUnion" });
			},
			IfStatement(node) {
				const parent = ancestorsOf(context.sourceCode, node).at(-1);
				if (parent?.type === "IfStatement" && parent.alternate === node) return;
				if (!ifChainIsSentinel(node)) return;
				const conditions = [node.test];
				let branch: ESTree.Statement | null = node.alternate;
				while (branch !== null) {
					if (branch.type !== "IfStatement") break;
					conditions.push(branch.test);
					branch = branch.alternate;
				}
				if (!conditions.some(hasOrderingComparison)) return;
				context.report({ node, messageId: "sentinelComparisonUnion" });
			},
		};
	},
});
