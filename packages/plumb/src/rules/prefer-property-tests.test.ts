import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { preferPropertyTestsRule } from "./prefer-property-tests.ts";

wireRuleTester({ describe, it });

// The rule caches "saw fast-check" across the adapter's shared createOnce
// lifecycle, so the positive and negative suites run as separate instances.
new RuleTester().run(
	"prefer-property-tests (missing fast-check)",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferPropertyTestsRule) as never,
	{
		valid: [{ code: `const x = 1;`, filename: "a.ts" }],
		invalid: [
			{ code: `import { describe } from "vitest";`, filename: "a.test.ts", errors: [{ messageId: "useFastCheck" }] },
		],
	},
);

new RuleTester().run(
	"prefer-property-tests (with fast-check)",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferPropertyTestsRule) as never,
	{
		valid: [{ code: `import fc from "fast-check";`, filename: "a.test.ts" }],
		invalid: [],
	},
);
