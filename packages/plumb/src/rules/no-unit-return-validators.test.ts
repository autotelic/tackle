import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noUnitReturnValidatorsRule } from "./no-unit-return-validators.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unit-return-validators",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnitReturnValidatorsRule) as never,
	{
		valid: [
			{ code: `export function handleInput(): void {}`, filename: "a.ts" },
			{ code: `export function validateInput(): boolean { return true; }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function validateInput(): void {}`, filename: "a.ts", errors: [{ messageId: "unitValidator" }] },
		],
	},
);
