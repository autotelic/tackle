import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noStackedJsdocBlocksRule } from "./no-stacked-jsdoc-blocks.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-stacked-jsdoc-blocks",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noStackedJsdocBlocksRule) as never,
	{
		valid: [
			{ code: `/** one */\nconst x = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `/** one */\n/** two */\nconst x = 1;`, filename: "a.ts", errors: [{ messageId: "stackedJsdoc" }] },
		],
	},
);
