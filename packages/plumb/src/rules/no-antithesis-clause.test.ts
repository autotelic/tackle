import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { firstMatch, proseOfComment } from "../shared/prose-sites.ts";
import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { CORRECTIONS, noAntithesisClauseRule } from "./no-antithesis-clause.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-antithesis-clause",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noAntithesisClauseRule) as never,
	{
		valid: [
			{ code: "/** The cache maps a key to an answer. */\nexport const a = 1;", filename: "a.ts" },
			{ code: "// A cache that only grows is a leak.\nexport const b = 1;", filename: "b.ts" },
		],
		invalid: [
			{
				code: "/** This is not a cache. It is a memo. */\nexport const a = 1;",
				filename: "a.ts",
				errors: [{ messageId: "antithesis" }],
			},
			{
				code: "// The id is not positional, but content-addressed.\nexport const b = 1;",
				filename: "b.ts",
				errors: [{ messageId: "antithesis" }],
			},
			{
				code: 'export const c = "The table is not an answer, but its inputs.";',
				filename: "c.ts",
				errors: [{ messageId: "antithesis" }],
			},
		],
	},
);

const block = (value: string) => ({ type: "Block", value, loc: { start: { line: 1 } } });

it("finds a correction however the comment wraps it", () => {
	fc.assert(
		fc.property(fc.string(), fc.string(), (before, after) => {
			const value = "* " + before.replace(/\s+/gu, " ") + " This is not a cache. It is a memo. " + after.replace(/\s+/gu, " ");
			return firstMatch(proseOfComment(block(value)).text, CORRECTIONS) !== undefined;
		}),
	);
});
