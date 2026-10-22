import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireFcBlockPredicateRule } from "./require-fc-block-predicate.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-fc-block-predicate",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireFcBlockPredicateRule) as never,
	{
		valid: [
			{ code: `fc.property(fc.integer(), (x) => { return x > 0; });`, filename: "a.ts" },
		],
		invalid: [
			{ code: `fc.property(fc.integer(), (x) => x > 0);`, filename: "a.ts", errors: [{ messageId: "blockBody" }] },
		],
	},
);
