import { RuleTester } from "oxlint/plugins-dev";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { useEncapsulationRule, isEncapsulationViolation } from "./use-encapsulation.ts";
import { isProviderName } from "../role.ts";

wireRuleTester({ describe, it });

const HOOKS = new Set([
	"useCallback",
	"useContext",
	"useDebugValue",
	"useDeferredValue",
	"useEffect",
	"useId",
	"useImperativeHandle",
	"useInsertionEffect",
	"useLayoutEffect",
	"useMemo",
	"useReducer",
	"useRef",
	"useState",
	"useSyncExternalStore",
	"useTransition",
]);

new RuleTester().run("use-encapsulation", testableRule(useEncapsulationRule) as never, {
	valid: [
		{
			code: `export function useToggle() {
  const [on, setOn] = useState(false);
  return on;
}`,
			filename: "a.ts",
		},
		{
			code: `export const Ctx = createContext<{ state: number } | undefined>(undefined);
export function useCounter() {
  const context = useContext(Ctx);
  if (!context) throw new Error("missing");
  return context;
}`,
			filename: "a.ts",
		},
		{
			code: `export function CounterProvider() {
  const [count, setCount] = useState(0);
  return count;
}`,
			filename: "a.ts",
		},
	],
	invalid: [
		{
			code: `export function Counter() {
  const [count, setCount] = useState(0);
  return count;
}`,
			filename: "a.ts",
			errors: [{ messageId: "noDirectHooks" }],
		},
	],
});

describe("use-encapsulation property", () => {
	it("isEncapsulationViolation holds for the React hook set", () => {
		fc.assert(
			fc.property(
				fc.tuple(fc.string(), fc.string()),
				([hookName, parentName]) => {
					const expected = HOOKS.has(hookName) && !/^use/u.test(parentName) && !isProviderName(parentName);
					expect(isEncapsulationViolation({ hookName, parentName })).toBe(expected);
				},
			),
		);
	});
});
