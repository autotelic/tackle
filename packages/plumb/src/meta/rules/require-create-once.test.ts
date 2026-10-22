import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireCreateOnceRule } from "./require-create-once.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-create-once",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireCreateOnceRule) as never,
	{
		valid: [
			{ code: `const r = { meta: {}, createOnce() {} };`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const r = { meta: {}, create() {} };`, filename: "a.ts", errors: [{ messageId: "useCreateOnce" }] },
		],
	},
);
