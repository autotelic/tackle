import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferTaggedEnumRule } from "./prefer-tagged-enum.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-tagged-enum",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferTaggedEnumRule) as never,
	{
		valid: [
			{ code: `type State = { a: number } | { b: string };`, filename: "a.ts" },
		],
		invalid: [
			{ code: `type State = { _tag: "A" } | { _tag: "B" };`, filename: "a.ts", errors: [{ messageId: "preferTaggedEnum" }] },
		],
	},
);
