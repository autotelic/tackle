import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noUnknownReturnsRule } from "./no-unknown-returns.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unknown-returns",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnknownReturnsRule) as never,
	{
		valid: [
			{ code: `function f(): string { return "x"; }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f(): unknown {}`, filename: "a.ts", errors: [{ messageId: "unknownReturn" }] },
			{ code: `function f(): Promise<unknown> {}`, filename: "a.ts", errors: [{ messageId: "unknownReturn" }] },
		],
	},
);
