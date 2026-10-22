import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferDieForPreconditionDefectsRule } from "./prefer-die-for-precondition-defects.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-die-for-precondition-defects",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferDieForPreconditionDefectsRule) as never,
	{
		valid: [
			{ code: `function f(): void { throw new Error("x"); }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f(): Effect.Effect<void> { throw new Error("x"); }`, filename: "a.ts", errors: [{ messageId: "bareThrow" }] },
		],
	},
);
