import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const RULE_TEST_FILE = /[/\\](?:rules|effect[/\\]rules|meta[/\\]rules)[/\\][^/\\]+\.test\.[cm]?[jt]sx?$/u;

/** Tests for lint rules belong in Oxlint's RuleTester: valid/invalid cases with message and span assertions. */
export const requireRuleTesterRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require test files co-located with lint rules to drive the rule through `RuleTester` (oxlint/plugins-dev).",
		},
		messages: {
			useRuleTester:
				"This test file sits next to a lint rule but does not import `RuleTester` from `oxlint/plugins-dev`. Rule behavior should be pinned through valid/invalid cases with message and span assertions.",
			neverRuns:
				"`RuleTester` is imported but `run()` is never called. Every rule suite must execute `ruleTester.run(...)`.",
		},
	},
	createOnce(context) {
		let program: ESTree.Program | null = null;
		let importsRuleTester = false;
		let callsRun = false;
		return {
			before() {
				if (!RULE_TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			Program(node) {
				program = node;
			},
			ImportDeclaration(node) {
				const usesRuleTester = node.specifiers.some(
					(specifier) =>
						specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "RuleTester",
				);
				if (usesRuleTester) importsRuleTester = true;
			},
			CallExpression(node) {
				if (
					node.callee.type === "MemberExpression" &&
					!node.callee.computed &&
					node.callee.property.type === "Identifier" &&
					node.callee.property.name === "run"
				) {
					callsRun = true;
				}
			},
			"Program:exit"() {
				if (program === null) return;
				if (!importsRuleTester) context.report({ node: program, messageId: "useRuleTester" });
				else if (!callsRun) context.report({ node: program, messageId: "neverRuns" });
			},
		};
	},
});
