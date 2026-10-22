import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-conditional-empty-object-spread",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noConditionalEmptyObjectSpreadRule) as never,
	{
		valid: [
			{ code: `const o = { ...base };`, filename: "a.ts" },
			{ code: `const o = { ...(cond ? { a: 1 } : { b: 2 }) };`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const o = { ...(cond ? {} : { a: 1 }) };`, filename: "a.ts", errors: [{ messageId: "avoid" }] },
		],
	},
);
