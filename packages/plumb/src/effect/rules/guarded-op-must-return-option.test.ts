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
		// The return-shape rows live in absence-shape-matrix.test.ts, which runs
		// both rules over the same matrix; these are the rule's own escapes.
		valid: [{ code: `export function f(): string { return "x"; }`, filename: "a.ts" }],
		invalid: [
			{ code: `const v = x.getOrThrow();`, filename: "a.ts", errors: [{ messageId: "optionEscape" }] },
		],
	},
);
