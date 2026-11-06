import { defineRule } from "@oxlint/plugins";

import { TEST_FILE, firstMatch, proseOfComment, proseOfLiteral } from "../shared/prose-sites.ts";
import { getAllComments } from "../shared/structural.ts";

/** The closers that grade the material instead of adding a fact.
 *
 * Each one ends a paragraph by asserting that the paragraph mattered. Deleting the
 * sentence loses no information, which is the test the rule applies.
 */
export const CLOSERS: ReadonlyArray<RegExp> = [
	/\b(?:that|it|this|which) is the (?:whole )?point\b/iu,
	/\bthe (?:whole )?point of (?:the )?(?:thing|machine|exercise|funnel|report|tool|repository)\b/iu,
	/\b(?:is|are) not decoration\b/iu,
	/\b(?:earns|earned) its (?:place|keep)\b/iu,
	/\bthat is the tool working\b/iu,
	/\bnot an? (?:accident|coincidence)\b/iu,
];

/** A comment or a message that asserts its own importance instead of stating a fact. */
export const noProseVerdictRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow prose that grades the material instead of stating a fact ('that is the whole point', 'the notes are not decoration', 'earns its keep'). Deleting such a sentence loses no information, so it costs a reader a conversion with nothing to show for it.",
		},
		messages: {
			verdict:
				"'{{phrase}}' asserts that the material matters. Delete the sentence, or replace it with the fact it was standing in for.",
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
					const phrase = firstMatch(site.text, CLOSERS);
					if (phrase === undefined) continue;
					context.report({
						loc: { start: { line: site.line, column: site.column } },
						messageId: "verdict",
						data: { phrase },
					});
				}
			},
			Literal(node) {
				const text = proseOfLiteral(node.value);
				const phrase = text === undefined ? undefined : firstMatch(text, CLOSERS);
				if (phrase === undefined) return;
				context.report({ node, messageId: "verdict", data: { phrase } });
			},
			TemplateElement(node) {
				const text = proseOfLiteral(node.value?.cooked);
				const phrase = text === undefined ? undefined : firstMatch(text, CLOSERS);
				if (phrase === undefined) return;
				context.report({ node, messageId: "verdict", data: { phrase } });
			},
		};
	},
});
