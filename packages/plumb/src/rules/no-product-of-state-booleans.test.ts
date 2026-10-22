import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noProductOfStateBooleansRule } from "./no-product-of-state-booleans.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-product-of-state-booleans",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noProductOfStateBooleansRule) as never,
	{
		valid: [
			{ code: `type Sign = Data.TaggedEnum<{ Sign: { positive: boolean } }>;`, filename: "a.ts" },
			{ code: `type Pair = { positive: boolean; negative: boolean };`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `type Sign = Data.TaggedEnum<{ Sign: { positive: boolean; negative: boolean } }>;`,
				filename: "a.ts",
				errors: [{ messageId: "productOfStateBooleans" }],
			},
		],
	},
);
