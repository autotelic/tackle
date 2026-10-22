import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireDeprecatedTagForLegacyCommentsRule } from "./require-deprecated-tag-for-legacy-comments.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-deprecated-tag-for-legacy-comments",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireDeprecatedTagForLegacyCommentsRule) as never,
	{
		valid: [
			{ code: `/** @deprecated use y instead */\nconst x = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `/** legacy helper */\nconst x = 1;`, filename: "a.ts", errors: [{ messageId: "missingDeprecatedTag" }] },
		],
	},
);
