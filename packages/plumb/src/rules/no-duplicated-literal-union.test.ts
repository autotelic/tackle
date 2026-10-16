import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noDuplicatedLiteralUnionRule } from "./no-duplicated-literal-union.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-duplicated-literal-union",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDuplicatedLiteralUnionRule) as never,
	{
		valid: [
			{ code: `type A = "x" | "y";`, filename: "a.ts" },
			{ code: `type B = "x" | "y";`, filename: "b.ts" },
			{ code: `type A = "x" | "y"; type B = "x" | "z";`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `type C = "x" | "y"; type D = "y" | "x";`,
				filename: "c.ts",
				errors: [{ messageId: "duplicateUnion", data: { first: "C", second: "D" } }],
			},
		],
	},
);
