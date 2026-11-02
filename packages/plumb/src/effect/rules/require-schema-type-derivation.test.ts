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
			// Cross-file: `PayrollSchema` was declared in a previous file of the same run.
			// A per-file rule has forgotten it; `createOnce` state reported `Payroll` here,
			// at line 1 column 1, against a file that does not mention the schema at all.
			{ code: `interface Payroll {\n\tamount: number;\n}`, filename: "b.ts" },
			// The fix this rule asks for, not the twin: a derived interface has a heritage
			// clause and must never be reported as hand-written.
			{
				code: `const PayrollSchema = Schema.Struct({});\ninterface Payroll extends Schema.Type<typeof PayrollSchema> {}`,
				filename: "c.ts",
			},
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
