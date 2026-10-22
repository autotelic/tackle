import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireSortComparatorRule } from "./require-sort-comparator.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-sort-comparator",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireSortComparatorRule) as never,
	{
		valid: [
			{ code: `[3, 1].sort((a, b) => a - b);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `[3, 1].sort();`, filename: "a.ts", errors: [{ messageId: "missingComparator" }] },
		],
	},
);
