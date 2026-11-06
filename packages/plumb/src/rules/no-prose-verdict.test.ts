import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { firstMatch, proseOfComment } from "../shared/prose-sites.ts";
import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { CLOSERS, noProseVerdictRule } from "./no-prose-verdict.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-prose-verdict",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noProseVerdictRule) as never,
	{
		valid: [
			{ code: "/** Returns the value, cut to 40 characters with an ellipsis. */\nexport const a = 1;", filename: "a.ts" },
			{ code: "// The cache is keyed by the question and the atoms it read.\nexport const b = 1;", filename: "b.ts" },
			{ code: 'export const c = "no_issue";', filename: "c.ts" },
		],
		invalid: [
			{
				code: "/** The notes are not decoration. */\nexport const a = 1;",
				filename: "a.ts",
				errors: [{ messageId: "verdict" }],
			},
			{
				code: "// Content-addressed rather than positional, and that is the whole point.\nexport const b = 1;",
				filename: "b.ts",
				errors: [{ messageId: "verdict" }],
			},
			{
				code: 'export const c = "That is the whole point of the funnel.";',
				filename: "c.ts",
				errors: [{ messageId: "verdict" }],
			},
			{
				code: "export const d = `The plane earns its keep.`;",
				filename: "d.ts",
				errors: [{ messageId: "verdict" }],
			},
		],
	},
);

const block = (value: string) => ({ type: "Block", value, loc: { start: { line: 1 } } });

it("finds a closer however the comment wraps it", () => {
	fc.assert(
		fc.property(fc.string(), fc.string(), (before, after) => {
			const value = "* " + before.replace(/\s+/gu, " ") + " the notes are not decoration. " + after.replace(/\s+/gu, " ");
			return firstMatch(proseOfComment(block(value)).text, CLOSERS) !== undefined;
		}),
	);
});
