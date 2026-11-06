import { defineRule } from "@oxlint/plugins";

import { TEST_FILE, firstMatch, proseOfComment, proseOfLiteral } from "../shared/prose-sites.ts";
import { getAllComments } from "../shared/structural.ts";

/** A program that can be the subject of a sentence. */
const PROGRAMS =
	"(?:report|rule|tool|model|judge|checker|compiler|linter|engine|cache|index|funnel|catalog|catalogue|scanner|parser|ledger|baseline|gate|ratchet|pass)s?";

/** What a program cannot do: the verbs below name a mind, not a mechanism.
 *
 * `says` and `decides` are left out on purpose. A program reports an answer and a
 * rule chooses a band: both are shorthand a reader parses without the metaphor,
 * and a rule that reports them is a rule that fires on the whole corpus.
 */
const MENTAL =
	"knows?|wants?|refuses?|believes?|thinks?|hopes?|remembers?|forgets?|cares?|hates?|loves?|prefers?|fears?";

/** `expects` and `assumes` are absent on purpose: a cache expects a key the way
 * a key matches one, which a reader parses without the metaphor. The list is the
 * verbs that only a mind can do. */
export const ANTHROPOMORPHIC: ReadonlyArray<RegExp> = [
	new RegExp("\\bthe " + PROGRAMS + "\\s+(?:" + MENTAL + ")\\b", "iu"),
	new RegExp("\\b(?:it|they|this|that)\\s+(?:" + MENTAL + ")\\b", "iu"),
];

/** A sentence that makes a program the subject of a mental verb. */
export const noAnthropomorphicProgramRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow prose that gives a program a mind ('the rule knows', 'the report wants', 'the model refuses'). Name the value and where it comes from: the reader needs the mechanism, not the intention.",
		},
		messages: {
			anthropomorphism:
				"'{{phrase}}' gives a program a mind. Write the value and its source: 'the answer's label is X', not 'the model knows X'.",
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
					const phrase = firstMatch(site.text, ANTHROPOMORPHIC);
					if (phrase === undefined) continue;
					context.report({
						loc: { start: { line: site.line, column: site.column } },
						messageId: "anthropomorphism",
						data: { phrase: phrase.trim() },
					});
				}
			},
			Literal(node) {
				const text = proseOfLiteral(node.value);
				const phrase = text === undefined ? undefined : firstMatch(text, ANTHROPOMORPHIC);
				if (phrase === undefined) return;
				context.report({ node, messageId: "anthropomorphism", data: { phrase: phrase.trim() } });
			},
			TemplateElement(node) {
				const text = proseOfLiteral(node.value?.cooked);
				const phrase = text === undefined ? undefined : firstMatch(text, ANTHROPOMORPHIC);
				if (phrase === undefined) return;
				context.report({ node, messageId: "anthropomorphism", data: { phrase: phrase.trim() } });
			},
		};
	},
});
