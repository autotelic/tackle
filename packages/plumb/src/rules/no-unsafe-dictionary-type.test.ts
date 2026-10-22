import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noUnsafeDictionaryTypeRule } from "./no-unsafe-dictionary-type.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unsafe-dictionary-type",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnsafeDictionaryTypeRule) as never,
	{
		valid: [
			{ code: `type D = Record<string, string>;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `type D = Record<string, unknown>;`, filename: "a.ts", errors: [{ messageId: "unsafeDictionary" }] },
		],
	},
);
