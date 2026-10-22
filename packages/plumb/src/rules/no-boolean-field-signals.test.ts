import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noBooleanFieldSignalsRule } from "./no-boolean-field-signals.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-boolean-field-signals",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noBooleanFieldSignalsRule) as never,
	{
		valid: [
			{ code: `interface Flags { active: boolean; visible: boolean; }`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `interface Flags { active: boolean; visible: boolean; pinned: boolean; }`,
				filename: "a.ts",
				errors: [{ messageId: "booleanStateProduct" }],
			},
		],
	},
);
