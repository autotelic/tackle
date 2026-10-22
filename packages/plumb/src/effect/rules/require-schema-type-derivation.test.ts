import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireSchemaTypeDerivationRule } from "./require-schema-type-derivation.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-schema-type-derivation",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireSchemaTypeDerivationRule) as never,
	{
		valid: [
			{ code: `const UserSchema = Schema.Struct({});`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `const UserSchema = Schema.Struct({});\ntype User = { name: string };`,
				filename: "a.ts",
				errors: [{ messageId: "handWrittenTwin" }],
			},
		],
	},
);
