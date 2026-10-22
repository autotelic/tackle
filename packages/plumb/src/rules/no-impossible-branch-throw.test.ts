import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noImpossibleBranchThrowRule } from "./no-impossible-branch-throw.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-impossible-branch-throw",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noImpossibleBranchThrowRule) as never,
	{
		valid: [
			{ code: `throw new Error("bad input");`, filename: "a.ts" },
			{ code: `throw new Error("this should never happen");`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `throw new Error("this should never happen");`, filename: "a.ts", errors: [{ messageId: "impossibleThrow" }] },
		],
	},
);
