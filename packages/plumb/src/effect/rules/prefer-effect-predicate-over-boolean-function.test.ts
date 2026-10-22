import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferEffectPredicateOverBooleanFunctionRule } from "./prefer-effect-predicate-over-boolean-function.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-effect-predicate-over-boolean-function",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferEffectPredicateOverBooleanFunctionRule) as never,
	{
		valid: [
			{ code: `export function isActive(x: unknown): boolean { return true; }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function isActive(x: string): boolean { return true; }`, filename: "a.ts", errors: [{ messageId: "booleanPredicateReturn" }] },
		],
	},
);
