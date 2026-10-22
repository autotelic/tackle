import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireExhaustiveTagSwitchRule } from "./require-exhaustive-tag-switch.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-exhaustive-tag-switch",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireExhaustiveTagSwitchRule) as never,
	{
		valid: [
			{ code: `switch (x._tag) { case "A": break; }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `switch (x._tag) { default: break; }`, filename: "a.ts", errors: [{ messageId: "noDefault" }] },
		],
	},
);
