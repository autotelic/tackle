import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-chained-type-assertions",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noChainedTypeAssertionsRule) as never,
	{
		valid: [
			{ code: `const x = y as string;`, filename: "a.ts" },
			{ code: `const x = y as const;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = y as unknown as string;`, filename: "a.ts", errors: [{ messageId: "chained" }] },
		],
	},
);
