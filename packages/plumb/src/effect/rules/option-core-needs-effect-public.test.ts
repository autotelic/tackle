import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { optionCoreNeedsEffectPublicRule } from "./option-core-needs-effect-public.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"option-core-needs-effect-public",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(optionCoreNeedsEffectPublicRule) as never,
	{
		valid: [
			{ code: `export function findUser() {}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export function findUserOption() {}`, filename: "a.ts", errors: [{ messageId: "missingTwin" }] },
		],
	},
);
