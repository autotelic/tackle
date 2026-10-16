import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Inline suppression comments hide lint failures from the exact files where
 * enforcement matters most. Fix the code or scope a justified override in the
 * config; do not silence rules line-by-line.
 */
export const noDisableDirectivesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `// oxlint-disable` suppression comments; fix the finding or add a justified file-scoped config override instead.",
		},
		messages: {
			suppressionDirective:
				"Inline suppression comments make findings invisible without making them gone. Prefer fixing the code; if an exception is truly warranted, use a scoped override entry in oxlint.config.ts with a written reason.",
		},
	},
	createOnce(context) {
		let program: ESTree.Program | null = null;
		return {
			Program(node) {
				program = node;
			},
			"Program:exit"() {
				if (program === null) return;
				for (const comment of context.sourceCode.getAllComments()) {
					if (!/^\s*oxlint-disable\b/u.test(comment.value)) continue;
					context.report({ node: program, messageId: "suppressionDirective" });
					return;
				}
			},
		};
	},
});
