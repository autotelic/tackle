import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { preferNamedGuardPredicateRule } from "./prefer-named-guard-predicate.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-named-guard-predicate",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferNamedGuardPredicateRule) as never,
	{
		valid: [
			{ code: `const x = isFoo(a) ? 1 : 0;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = isFoo(a) && isBar(b) ? Option.some(1) : Option.none();`, filename: "a.ts", errors: [{ messageId: "namedGuardPredicate" }] },
		],
	},
);
