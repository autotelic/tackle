import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noManualFieldGuardsRule } from "./no-manual-field-guards.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-manual-field-guards",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noManualFieldGuardsRule) as never,
	{
		valid: [
			{ code: `/^a/u.test(s);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `SchemaParser.decodeUnknown(x);\n/^a/u.test(s);`, filename: "a.ts", errors: [{ messageId: "regexTest" }] },
		],
	},
);
