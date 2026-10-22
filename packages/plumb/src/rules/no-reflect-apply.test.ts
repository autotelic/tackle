import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noReflectApplyRule } from "./no-reflect-apply.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-reflect-apply",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noReflectApplyRule) as never,
	{
		valid: [
			{ code: `fn.apply(null, []);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `Reflect.apply(fn, null, []);`, filename: "a.ts", errors: [{ messageId: "reflectApply" }] },
		],
	},
);
