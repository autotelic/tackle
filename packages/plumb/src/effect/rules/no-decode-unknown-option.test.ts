import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noDecodeUnknownOptionRule } from "./no-decode-unknown-option.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-decode-unknown-option",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDecodeUnknownOptionRule) as never,
	{
		valid: [
			{ code: `const x = Schema.decodeUnknownResult(s);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = Schema.decodeUnknownOption(s);`, filename: "a.ts", errors: [{ messageId: "noDecodeUnknownOption" }] },
		],
	},
);
