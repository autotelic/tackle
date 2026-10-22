import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferEffectMatchRule } from "./prefer-effect-match.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-effect-match",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferEffectMatchRule) as never,
	{
		valid: [
			{ code: `const x = v === "a" ? 1 : 2;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = v === "a" ? 1 : v === "b" ? 2 : 3;`, filename: "a.ts", errors: [{ messageId: "preferMatch" }] },
		],
	},
);
