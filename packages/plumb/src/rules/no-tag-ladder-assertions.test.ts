import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noTagLadderAssertionsRule } from "./no-tag-ladder-assertions.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-tag-ladder-assertions",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noTagLadderAssertionsRule) as never,
	{
		valid: [
			{ code: `if (x._tag !== "A") { return; }`, filename: "a.ts" },
		],
		invalid: [
			{ code: `if (x._tag !== "A") throw new Error("bad");`, filename: "a.ts", errors: [{ messageId: "ladder" }] },
		],
	},
);
