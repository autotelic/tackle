import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { requireCanonicalStringifyForIdentityRule } from "./require-canonical-stringify-for-identity.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"require-canonical-stringify-for-identity",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireCanonicalStringifyForIdentityRule) as never,
	{
		valid: [
			{ code: `const s = JSON.stringify(a);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const same = JSON.stringify(a) === b;`, filename: "a.ts", errors: [{ messageId: "nonCanonicalIdentity" }] },
		],
	},
);
