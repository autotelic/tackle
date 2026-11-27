import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { guardedOpMustReturnEffectRule } from "./guarded-op-must-return-effect.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"guarded-op-must-return-effect",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(guardedOpMustReturnEffectRule) as never,
	{
		// The return-shape rows live in absence-shape-matrix.test.ts, which runs
		// both rules over the same matrix; these are the rule's own escapes.
		valid: [
			{ code: `export function findUser(id: string): Effect.Effect<string> { return Effect.succeed(id); }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function f(): void { return Option.none(); }`, filename: "a.ts", errors: [{ messageId: "bareNone" }] },
		],
	},
);
