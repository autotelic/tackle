import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noStrayInlineCommentsRule } from "./no-stray-inline-comments.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-stray-inline-comments",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noStrayInlineCommentsRule) as never,
	{
		valid: [
			{ code: `function f() {\n\treturn 1;\n}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `function f() {\n\t// note\n\treturn 1;\n}`, filename: "a.ts", errors: [{ messageId: "strayInlineComment" }] },
		],
	},
);
