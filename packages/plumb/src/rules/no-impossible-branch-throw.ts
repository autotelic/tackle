import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { isRecordObject, isString } from "../shared/structural.ts";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const IMPOSSIBLE_MESSAGE =
	/(?:never\s+happen|impossible|unreachable|invariant|cannot\s+happen|can'?t\s+happen|unexpected\s+state|not\s+possible)/iu;

/** Extract the prose message of a thrown error literal or constructor.
 *
 * @param {ESTree.ThrowStatement} node - The throw statement to inspect.
 * @returns {string | null} The thrown message, or null when not a string literal.
 */
function throwMessage(node: ESTree.ThrowStatement): string | null {
	const argument = node.argument;
	if (argument === null || argument === undefined) return null;
	if (argument.type === "Literal" && isString(argument.value)) return argument.value;
	if (argument.type === "NewExpression") {
		const first = argument.arguments[0];
		if (first !== undefined && first.type === "Literal" && isString(first.value)) {
			return first.value;
		}
	}
	return null;
}

/** Reject "should never happen" throws; encode the case out of the type instead. */
export const noImpossibleBranchThrowRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow hand-asserted impossible branches (throws about never-happens/invariants); encode the case out of the type so the compiler rejects it.",
		},
		messages: {
			impossibleThrow:
				"This branch is asserted impossible by hand (\"{{message}}\"). If it truly cannot occur, parse/encode it out of the type (Option, parsed/refined type) so the compiler rejects it; otherwise return a structured failure.",
		},
	},
	createOnce(context) {

		return {
		before() {
			if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
		},
			ThrowStatement(node) {
				const message = throwMessage(node);
				if (message === null) return;
				if (!IMPOSSIBLE_MESSAGE.test(message)) return;
				context.report({ node, messageId: "impossibleThrow", data: { message } });
			},
		};
	},
});
