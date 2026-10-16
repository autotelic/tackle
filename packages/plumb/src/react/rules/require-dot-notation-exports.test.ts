import { RuleTester } from "oxlint/plugins-dev";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireDotNotationExportsRule, familyRequiresAggregate } from "./require-dot-notation-exports.ts";

wireRuleTester({ describe, it });

new RuleTester().run("require-dot-notation-exports", testableRule(requireDotNotationExportsRule) as never, {
	valid: [
		{
			code: `export function Provider() { return null; }
export function useExpenseCategory() { return null; }
export const ExpenseCategory = {
  Provider,
  useExpenseCategory,
};`,
			filename: "a.ts",
		},
		{
			code: `export function CounterProvider() {}`,
			filename: "a.ts",
		},
		{
			code: `export function CounterProvider() { return null; }
export function useCounter() { return null; }
export const Counter = { Provider: CounterProvider, Display: CounterProvider };`,
			filename: "a.ts",
		},
	],
	invalid: [
		{
			code: `export function Provider() { return null; }
export function useExpenseCategory() { return null; }`,
			filename: "a.ts",
			errors: [{ messageId: "missingAggregate" }],
		},
		{
			code: `export function CounterProvider() { return null; }
export function useCounter() { return null; }
export const Counter = { Display: CounterProvider };`,
			filename: "a.ts",
			errors: [{ messageId: "missingAggregate" }],
		},
	],
});

describe("require-dot-notation-exports property", () => {
	it("familyRequiresAggregate is true iff a Provider matching the hook family lacks an aggregate", () => {
		fc.assert(
			fc.property(
				fc.tuple(
					fc.string(),
					fc.oneof(fc.constant(null), fc.constant(""), fc.string()),
					fc.boolean(),
					fc.boolean(),
				),
				([hookFamily, providerFamily, singleFamily, aggregateOk]) => {
					const expected =
						((providerFamily === hookFamily) || (providerFamily === "" && singleFamily)) && !aggregateOk;
					expect(familyRequiresAggregate({ providerFamily, hookFamily, singleFamily, aggregateOk })).toBe(expected);
				},
			),
		);
	});
});
