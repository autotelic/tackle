import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferBeforeFileScopeRule } from "./prefer-before-file-scope.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-before-file-scope",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferBeforeFileScopeRule) as never,
	{
		valid: [
			{ code: `const x = { before() { return context.filename; } };`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const f = context.filename;`, filename: "a.ts", errors: [{ messageId: "moveToBefore" }] },
		],
	},
);
