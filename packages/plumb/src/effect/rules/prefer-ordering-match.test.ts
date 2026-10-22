import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferOrderingMatchRule } from "./prefer-ordering-match.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-ordering-match",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferOrderingMatchRule) as never,
	{
		valid: [
			{ code: `const x = v < 0 ? "neg" : "pos";`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = v < 0 ? "neg" : v > 0 ? "pos" : "zero";`, filename: "a.ts", errors: [{ messageId: "preferOrderingMatch" }] },
		],
	},
);
