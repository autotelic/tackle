import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noSentinelComparisonUnionRule } from "./no-sentinel-comparison-union.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-sentinel-comparison-union",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSentinelComparisonUnionRule) as never,
	{
		valid: [
			{ code: `const x = a < b ? "low" : "high";`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = a < b ? -1 : a > b ? 1 : 0;`, filename: "a.ts", errors: [{ messageId: "sentinelComparisonUnion" }] },
		],
	},
);
