import { defineRule } from "@oxlint/plugins";

import { TEST_FILE, firstMatch, proseOfComment, proseOfLiteral } from "../shared/prose-sites.ts";
import { getAllComments } from "../shared/structural.ts";

/** The two-clause corrections: "X is not A. It is B." and "not A, but B".
 *
 * The first clause only helps a reader who already believed A, and a reader who
 * did not has to hold a wrong idea for a sentence before it is corrected.
 */
export const CORRECTIONS: ReadonlyArray<RegExp> = [
	/\b(?:is|are|was|were) not\b[^.!?]{1,80}[.!?]\s+(?:it|this|that) is\b/iu,
	/\b(?:is|are|was|were) not\b[^.!?,]{1,80},\s*but\b/iu,
	/\bnot (?:a|an|the) [a-z][^.!?,]{0,60},\s*but\b/iu,
];

/** A sentence that corrects a belief the reader was never shown to hold. */
export const noAntithesisClauseRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow antithesis framing in prose ('this is not a cache, it is a memo'; 'not X, but Y'). State the second half: a correction of a belief nobody held makes the reader hold it first.",
		},
		messages: {
			antithesis:
				"'{{phrase}}' corrects a belief the reader was not shown to hold. State what it is, and drop the clause about what it is not.",
		},
	},
	// A spec's strings are fixtures, and the fixture holds the defect on purpose.
	createOnce(context) {
		return {
			before() {
				if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			"Program:exit"() {
				for (const comment of getAllComments(context.sourceCode)) {
					const site = proseOfComment(comment);
					const phrase = firstMatch(site.text, CORRECTIONS);
					if (phrase === undefined) continue;
					context.report({
						loc: { start: { line: site.line, column: site.column } },
						messageId: "antithesis",
						data: { phrase },
					});
				}
			},
			Literal(node) {
				const text = proseOfLiteral(node.value);
				const phrase = text === undefined ? undefined : firstMatch(text, CORRECTIONS);
				if (phrase === undefined) return;
				context.report({ node, messageId: "antithesis", data: { phrase } });
			},
			TemplateElement(node) {
				const text = proseOfLiteral(node.value?.cooked);
				const phrase = text === undefined ? undefined : firstMatch(text, CORRECTIONS);
				if (phrase === undefined) return;
				context.report({ node, messageId: "antithesis", data: { phrase } });
			},
		};
	},
});
