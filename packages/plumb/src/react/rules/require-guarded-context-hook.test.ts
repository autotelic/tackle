import { RuleTester } from "oxlint/plugins-dev";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireGuardedContextHookRule, requiresContextGuard } from "./require-guarded-context-hook.ts";

wireRuleTester({ describe, it });

new RuleTester().run("require-guarded-context-hook", testableRule(requireGuardedContextHookRule) as never, {
	valid: [
		{
			code: `export const Ctx = createContext<{ state: number } | undefined>(undefined);
export function useCounter() {
  const context = useContext(Ctx);
  if (!context) throw new Error("missing provider");
  return context;
}`,
			filename: "a.ts",
		},
		{
			code: `export const Ctx = createContext<{ state: number } | undefined>(undefined);
export function useCounter() {
  const context = useContext(Ctx);
  if (context === undefined) throw new Error("missing provider");
  return context;
}`,
			filename: "a.ts",
		},
	],
	invalid: [
		{
			code: `export const Ctx = createContext<{ state: number } | undefined>(undefined);
export function useCounter() {
  const context = useContext(Ctx);
  return context;
}`,
			filename: "a.ts",
			errors: [{ messageId: "unguardedContext" }],
		},
	],
});

describe("require-guarded-context-hook property", () => {
	it("requiresContextGuard is true iff a hook reads context but is unguarded", () => {
		fc.assert(
			fc.property(
				fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
				([isHook, callsUseContext, guarded]) => {
					expect(requiresContextGuard({ isHook, callsUseContext, guarded })).toBe(
						isHook && callsUseContext && !guarded,
					);
				},
			),
		);
	});
});
