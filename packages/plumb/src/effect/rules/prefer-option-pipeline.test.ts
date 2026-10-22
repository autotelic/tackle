import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferOptionPipelineRule } from "./prefer-option-pipeline.ts";

wireRuleTester({ describe, it });

// Two direct `Option.none()` returns are the rule's whole point. They were
// unreachable until `countDirectNoneReturns` descended into non-return
// statements: it returned before recursing, so a block body always counted zero.
const tester = new RuleTester();

tester.run(
	"prefer-option-pipeline",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferOptionPipelineRule) as never,
	{
		valid: [
			{
				code: `function f(): Option<string> {\n\tif (a) return Option.none();\n\treturn Option.some("x");\n}`,
				filename: "a.ts",
			},
		],
		invalid: [
			{
				code: `function f(): Option<string> {\n\tif (a) return Option.none();\n\treturn Option.none();\n}`,
				filename: "a.ts",
				errors: [{ messageId: "preferPipeline" }],
			},
		],
	},
);
