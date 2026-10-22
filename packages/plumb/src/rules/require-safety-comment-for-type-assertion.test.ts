import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-safety-comment-for-type-assertion",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireSafetyCommentForTypeAssertionRule) as never,
	{
		valid: [
			{ code: `// SAFETY: checked upstream\nconst x = y as string;`, filename: "a.ts" },
			{ code: `const x = y as const;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = y as string;`, filename: "a.ts", errors: [{ messageId: "missingSafetyComment" }] },
		],
	},
);
