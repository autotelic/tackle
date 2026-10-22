import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-shape-in-symbol-names",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noForbiddenTermInSymbolNamesRule) as never,
	{
		valid: [
			{ code: `const form = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const shape = 1;`, filename: "a.ts", errors: [{ messageId: "forbiddenSymbolName" }] },
		],
	},
);
