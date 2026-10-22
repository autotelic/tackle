import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noRedundantDerivedFieldRule } from "./no-redundant-derived-field.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-redundant-derived-field",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noRedundantDerivedFieldRule) as never,
	{
		valid: [
			{ code: `interface Foo { items: string[]; total: number; }`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `interface Foo { items: string[]; itemCount: number; }`,
				filename: "a.ts",
				errors: [{ messageId: "redundantCount" }],
			},
			{
				code: `interface Foo { entries: Record<string, number>; entryKeys: string[]; }`,
				filename: "a.ts",
				errors: [{ messageId: "parallelKeyArray" }],
			},
		],
	},
);
