import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * We default to property-based testing: a test suite without fast-check only
 * pins examples. Escape hatch is an explicit inline disable with a reason.
 */
export const preferPropertyTestsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require `fast-check` in every test file; suites that genuinely cannot use properties must disable this rule inline with a justification.",
		},
		messages: {
			useFastCheck:
				"No `fast-check` import: this suite only exercises hand-picked examples. Add property-based coverage (generate inputs, assert invariants), or disable this rule inline with a reason if the behavior is truly non-property-testable.",
		},
	},
	createOnce(context) {
		let program: ESTree.Program | null = null;
		let sawFastCheck = false;
		return {
			before() {
				if (!TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			Program(node) {
				program = node;
			},
			ImportDeclaration(node) {
				if (node.source.value === "fast-check") sawFastCheck = true;
			},
			"Program:exit"() {
				if (!sawFastCheck && program !== null) {
					context.report({ node: program, messageId: "useFastCheck" });
				}
			},
		};
	},
});
