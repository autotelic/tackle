import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noSwappablePrimitiveParamsRule } from "./no-swappable-primitive-params.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-swappable-primitive-params",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSwappablePrimitiveParamsRule) as never,
	{
		valid: [
			{ code: `export function f(a: string, b: number) {}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function f(a: string, b: string) {}`, filename: "a.ts", errors: [{ messageId: "swappablePrimitiveParams" }] },
		],
	},
);
