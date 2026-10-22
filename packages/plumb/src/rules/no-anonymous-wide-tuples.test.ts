import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noAnonymousWideTuplesRule } from "./no-anonymous-wide-tuples.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-anonymous-wide-tuples",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noAnonymousWideTuplesRule) as never,
	{
		valid: [
			{ code: `type Pair = [number, string];`, filename: "a.ts" },
			{ code: `type Single = [number];`, filename: "a.ts" },
		],
		invalid: [
			{ code: `type Triple = [number, string, boolean];`, filename: "a.ts", errors: [{ messageId: "wideTuple" }] },
		],
	},
);
