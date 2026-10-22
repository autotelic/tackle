import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noUnguardedJsonParseRule } from "./no-unguarded-json-parse.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unguarded-json-parse",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnguardedJsonParseRule) as never,
	{
		valid: [
			{ code: `const x = JSON.parse(s);`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `function parse(s: string): Effect.Effect<unknown> {\n\treturn JSON.parse(s);\n}`,
				filename: "a.ts",
				errors: [{ messageId: "unguardedParse" }],
			},
		],
	},
);
