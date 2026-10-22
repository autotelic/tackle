import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noModuleMockingRule } from "./no-module-mocking.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-module-mocking",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noModuleMockingRule) as never,
	{
		valid: [
			{ code: `vi.fn();`, filename: "a.ts" },
			{ code: `mock("x");`, filename: "a.ts" },
		],
		invalid: [
			{ code: `vi.mock("x");`, filename: "a.ts", errors: [{ messageId: "moduleMock" }] },
			{ code: `jest.mock("x");`, filename: "a.ts", errors: [{ messageId: "moduleMock" }] },
		],
	},
);
