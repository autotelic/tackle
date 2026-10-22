import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noTransposedFieldReadsRule } from "./no-transposed-field-reads.ts";

wireRuleTester({ describe, it });

const options = [{ groups: [["start", "end"]] }];

const tester = new RuleTester();

tester.run(
	"no-transposed-field-reads",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noTransposedFieldReadsRule) as never,
	{
		valid: [
			{ code: `f(a.start, a.end);`, filename: "a.ts", options },
		],
		invalid: [
			{ code: `f(a.end, a.start);`, filename: "a.ts", options, errors: [{ messageId: "transposedFieldReads" }] },
		],
	},
);
