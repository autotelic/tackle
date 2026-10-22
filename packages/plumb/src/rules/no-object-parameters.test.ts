import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noObjectParametersRule } from "./no-object-parameters.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-object-parameters",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noObjectParametersRule) as never,
	{
		valid: [
			{ code: `function f(x: { a: number }) {}`, filename: "a.ts" },
			{ code: `function f(x: string) {}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f(x: object) {}`, filename: "a.ts", errors: [{ messageId: "objectParameter" }] },
			{ code: `type O = object; function f(x: O) {}`, filename: "a.ts", errors: [{ messageId: "objectParameter" }] },
		],
	},
);
