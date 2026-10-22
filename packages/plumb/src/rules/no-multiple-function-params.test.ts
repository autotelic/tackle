import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noMultipleFunctionParamsRule } from "./no-multiple-function-params.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-multiple-function-params",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noMultipleFunctionParamsRule) as never,
	{
		valid: [
			{ code: `function f(payload: { a: number; b: number }) {}`, filename: "a.ts" },
			{ code: `[1].map((a, b) => a);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f(a: number, b: number) {}`, filename: "a.ts", errors: [{ messageId: "multipleParams" }] },
		],
	},
);
