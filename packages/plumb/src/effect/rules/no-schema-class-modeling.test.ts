import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noSchemaClassModelingRule } from "./no-schema-class-modeling.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-schema-class-modeling",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSchemaClassModelingRule) as never,
	{
		valid: [
			{ code: `const X = Schema.Struct({});`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const X = Schema.Class("X");`, filename: "a.ts", errors: [{ messageId: "schemaClass" }] },
			{ code: `class X extends Schema.TaggedClass {}`, filename: "a.ts", errors: [{ messageId: "schemaClass" }] },
		],
	},
);
