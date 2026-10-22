import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-widen-then-assert",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noWidenThenAssertRule) as never,
	{
		valid: [
			{ code: `const parsed = value as { a: number };`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `const value: unknown = { a: 1 };\nconst parsed = value as { a: number };`,
				filename: "a.ts",
				errors: [{ messageId: "widenThenAssert" }],
			},
		],
	},
);
