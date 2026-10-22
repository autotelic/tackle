import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferEffectGenForGuardLaddersRule } from "./prefer-effect-gen-for-guard-ladders.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-effect-gen-for-guard-ladders",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferEffectGenForGuardLaddersRule) as never,
	{
		valid: [
			{
				code: `function run() {\n\tconst a = Effect.flatMap(x, f);\n\tconst b = Effect.flatMap(y, g);\n\treturn b;\n}`,
				filename: "a.ts",
			},
		],
		invalid: [
			{
				code: `function run() {\n\tconst a = Effect.flatMap(x, f);\n\tconst b = Effect.flatMap(y, g);\n\tconst c = Effect.flatMap(z, h);\n\treturn c;\n}`,
				filename: "a.ts",
				errors: [{ messageId: "ladder" }],
			},
		],
	},
);
