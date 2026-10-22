import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noBuiltinThrowsRule } from "./no-builtin-throws.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-builtin-throws",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noBuiltinThrowsRule) as never,
	{
		valid: [
			{ code: `throw new MyError("failed");`, filename: "a.ts" },
			{ code: `throw new Error("failed");`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `throw new Error("failed");`, filename: "a.ts", errors: [{ messageId: "noBuiltinThrows" }] },
			{ code: `throw new TypeError("failed");`, filename: "a.ts", errors: [{ messageId: "noBuiltinThrows" }] },
		],
	},
);
