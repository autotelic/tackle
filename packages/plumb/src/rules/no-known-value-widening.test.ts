import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noKnownValueWideningRule } from "./no-known-value-widening.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-known-value-widening",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noKnownValueWideningRule) as never,
	{
		valid: [
			{ code: `const x: object = read();`, filename: "a.ts" },
			{ code: `const x = { a: 1 };`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x: object = {};`, filename: "a.ts", errors: [{ messageId: "widening" }] },
		],
	},
);
