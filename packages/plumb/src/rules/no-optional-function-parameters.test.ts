import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noOptionalFunctionParametersRule } from "./no-optional-function-parameters.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-optional-function-parameters",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noOptionalFunctionParametersRule) as never,
	{
		valid: [
			{ code: `function f(a: number | undefined) {}`, filename: "a.ts" },
			{ code: `function f(a?: number) {}`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `function f(a?: number) {}`, filename: "a.ts", errors: [{ messageId: "optionalParameter" }] },
		],
	},
);
