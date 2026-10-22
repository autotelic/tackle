import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { guardedOpMustReturnOptionRule } from "./guarded-op-must-return-option.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"guarded-op-must-return-option",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(guardedOpMustReturnOptionRule) as never,
	{
		valid: [
			{ code: `export function f(): string { return "x"; }`, filename: "a.ts" },
			{ code: `export function f(): Option<string> { return Option.none(); }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function f(): string | null { return null; }`, filename: "a.ts", errors: [{ messageId: "nullableReturn" }] },
			{ code: `const v = x.getOrThrow();`, filename: "a.ts", errors: [{ messageId: "optionEscape" }] },
		],
	},
);
