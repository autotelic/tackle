import { RuleTester } from "oxlint/plugins-dev";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireTripartiteContextRule, isTripartiteContextValue } from "./require-tripartite-context.ts";

wireRuleTester({ describe, it });

new RuleTester().run("require-tripartite-context", testableRule(requireTripartiteContextRule) as never, {
	valid: [
		{
			code: `export interface CounterContextValue {
  state: { count: number };
  actions: { increment: () => void };
  meta: { max: number };
}
export const CounterContext = createContext<CounterContextValue | undefined>(undefined);`,
			filename: "a.ts",
		},
		{
			code: `export type SettingsContextValue = {
  state: { open: boolean };
  actions: { toggle: () => void };
  meta: { id: string };
};
export const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);`,
			filename: "a.ts",
		},
	],
	invalid: [
		{
			code: `export interface BadContextValue {
  state: { count: number };
  actions: { increment: () => void };
}
export const BadContext = createContext<BadContextValue | undefined>(undefined);`,
			filename: "a.ts",
			errors: [{ messageId: "tripartiteContext" }],
		},
	],
});

describe("require-tripartite-context property", () => {
	it("isTripartiteContextValue is true iff state, actions, meta are all present", () => {
		fc.assert(
			fc.property(fc.array(fc.string()), (members) => {
				const expected = ["state", "actions", "meta"].every((key) => members.includes(key));
				expect(isTripartiteContextValue(members)).toBe(expected);
			}),
		);
	});
});
