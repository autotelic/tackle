import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noManualAncestorWalksRule } from "./no-manual-ancestor-walks.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-manual-ancestor-walks",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noManualAncestorWalksRule) as never,
	{
		valid: [
			{ code: `const p = node.parentNode;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const p = node.parent;`, filename: "a.ts", errors: [{ messageId: "useGetAncestors" }] },
		],
	},
);
