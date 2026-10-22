import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noMultipleFunctionParamsRule } from "./no-multiple-function-params.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-multiple-function-params",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noMultipleFunctionParamsRule) as never,
	{
		valid: [
			// One payload object is the remedy.
			{ code: `function f(payload: { a: number; b: number }) {}`, filename: "a.ts" },
			// Distinct annotated types cannot be transposed: the compiler rejects the swap.
			{ code: `function f(name: string, count: number) {}`, filename: "a.ts" },
			{
				code: `const f = (left: { id: string }, right: { id: string } | null) => left;`,
				filename: "a.ts",
			},
			// Callbacks are not the module's arity.
			{ code: `[1].map((a, b) => a);`, filename: "a.ts" },
			// A closure's arity is local, not the module's surface.
			{
				code: `const outer = (): string => { const inner = (a: string, b: string): string => a + b; return inner("a", "b"); };`,
				filename: "a.ts",
			},
		],
		invalid: [
			// Same type: swapping compiles.
			{
				code: `function f(a: number, b: number) {}`,
				filename: "a.ts",
				errors: [{ messageId: "multipleParams" }],
			},
			// An owned arrow binding was invisible while `parentOf` read `Program` as the parent.
			{
				code: `const f = (left: string, right: string): string => left + right;`,
				filename: "a.ts",
				errors: [{ messageId: "multipleParams" }],
			},
			// Adjacent parameters do not have to be the repeated pair.
			{
				code: `const f = (path: string, exports: ReadonlyArray<string>, name: string): string => path + exports.length + name;`,
				filename: "a.ts",
				errors: [{ messageId: "multipleParams" }],
			},
			// Unannotated parameters cannot prove distinctness.
			{
				code: `const f = (a, b) => a;`,
				filename: "a.ts",
				errors: [{ messageId: "multipleParams" }],
			},
		],
	},
);
