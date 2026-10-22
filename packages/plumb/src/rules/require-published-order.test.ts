import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requirePublishedOrderRule } from "./require-published-order.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-published-order",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requirePublishedOrderRule) as never,
	{
		valid: [
			{ code: `export function compare(a: number, b: number): -1 | 0 | 1 { return 0; }\nexport const Order = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function compare(a: number, b: number): -1 | 0 | 1 { return 0; }`, filename: "a.ts", errors: [{ messageId: "missingPublishedOrder" }] },
		],
	},
);
