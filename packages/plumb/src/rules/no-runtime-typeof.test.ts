import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-runtime-typeof",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noRuntimeTypeofRule) as never,
	{
		valid: [
			{ code: `const y = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `typeof x === "string";`, filename: "a.ts", errors: [{ messageId: "runtimeTypeof" }] },
		],
	},
);
