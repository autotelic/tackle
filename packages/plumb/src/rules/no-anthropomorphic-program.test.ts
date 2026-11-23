import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { firstMatch, proseOfComment } from "../shared/prose-sites.ts";
import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { ANTHROPOMORPHIC, noAnthropomorphicProgramRule } from "./no-anthropomorphic-program.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-anthropomorphic-program",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noAnthropomorphicProgramRule) as never,
	{
		valid: [
			{ code: "/** The answer's label is redundant. */\nexport const a = 1;", filename: "a.ts" },
			{ code: "// The rule reports both labels.\nexport const b = 1;", filename: "b.ts" },
			{ code: "// The cache expects a key on every read.\nexport const c = 1;", filename: "c.ts" },
		],
		invalid: [
			{
				code: "/** The rule knows which band each answer falls in. */\nexport const a = 1;",
				filename: "a.ts",
				errors: [{ messageId: "anthropomorphism" }],
			},
			{
				code: "// The report wants a path relative to the root.\nexport const b = 1;",
				filename: "b.ts",
				errors: [{ messageId: "anthropomorphism" }],
			},
			{
				code: 'export const c = "The model refuses to answer an impossible label.";',
				filename: "c.ts",
				errors: [{ messageId: "anthropomorphism" }],
			},
		],
	},
);

const block = (value: string) => ({ type: "Block", value, loc: { start: { line: 1 } } });

it("finds a mental verb however the comment wraps it", () => {
	fc.assert(
		fc.property(fc.string(), fc.string(), (before, after) => {
			const value = "* " + before.replace(/\s+/gu, " ") + " The rule knows the band. " + after.replace(/\s+/gu, " ");
			return firstMatch(proseOfComment(block(value)).text, ANTHROPOMORPHIC) !== undefined;
		}),
	);
});
