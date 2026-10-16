import { defineRule } from "@oxlint/plugins";

/** A JSDoc comment with its source span. */
type JSDocComment = { start: number; end: number; line: number };

interface CommentLike {
	type: string;
	value: string;
	range?: [number, number];
	loc?: { start: { line: number } };
}

/**
 * Collect JSDoc-style block comments with their source offsets.
 *
 * @param {{ getAllComments: () => CommentLike[]; text: string }} sourceCode - The rule's source-code accessor.
 * @returns {JSDocComment[]} Block comments paired with their source positions.
 */
function collectJSDoc(sourceCode: {
	getAllComments: () => CommentLike[];
	text: string;
}): JSDocComment[] {
	const comments: JSDocComment[] = [];
	for (const comment of sourceCode.getAllComments()) {
		if (comment.type !== "Block" || !comment.value.startsWith("*")) continue;
		comments.push({
			start: comment.range?.[0] ?? 0,
			end: comment.range?.[1] ?? 0,
			line: comment.loc?.start.line ?? 1,
		});
	}
	return comments;
}

/** Consecutive JSDoc blocks mean the outer one documents nothing. */
export const noStackedJsdocBlocksRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow stacked JSDoc blocks; tools attach only the last block to the following declaration, so any earlier block silently documents nothing.",
		},
		messages: {
			stackedJsdoc:
				"This JSDoc block is immediately followed by another; only the last one attaches to the declaration, so this block documents nothing. Merge the content into one block or delete the orphan.",
		},
	},
	createOnce(context) {
		return {
			Program() {
				const comments = collectJSDoc(context.sourceCode);
				for (let index = 1; index < comments.length; index += 1) {
					const previous = comments[index - 1]!;
					const current = comments[index]!;
					const between = context.sourceCode.text.slice(previous.end, current.start);
					if (between.trim() !== "") continue;
					context.report({
						loc: { start: { line: previous.line, column: 0 } },
						messageId: "stackedJsdoc",
					});
				}
			},
		};
	},
});
