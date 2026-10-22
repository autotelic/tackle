import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unknown-parameters",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnknownParametersRule) as never,
	{
		valid: [
			{ code: `function f(x: string) {}`, filename: "a.ts" },
			{ code: `function f(cause: unknown) {}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f(x: unknown) {}`, filename: "a.ts", errors: [{ messageId: "unknownParameter" }] },
		],
	},
);
