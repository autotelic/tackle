import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireJsdocOnExportedRule } from "./require-jsdoc-on-exported.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-jsdoc-on-exported",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireJsdocOnExportedRule) as never,
	{
		valid: [
			{ code: `/** doc */\nexport function f() {}`, filename: "a.ts" },
			{ code: `export function f() {}`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `export function f() {}`, filename: "a.ts", errors: [{ messageId: "missingJsdoc" }] },
		],
	},
);
