import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { requireRuleTesterRule } from "./require-rule-tester.ts";

wireRuleTester({ describe, it });

// The rule caches import/run observations across the adapter's shared
// createOnce lifecycle, so the negative and positive suites run separately.
new RuleTester().run(
	"require-rule-tester (missing RuleTester)",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireRuleTesterRule) as never,
	{
		valid: [{ code: `const x = 1;`, filename: "src/a.ts" }],
		invalid: [
			{ code: `import { describe } from "vitest";`, filename: "rules/foo.test.ts", errors: [{ messageId: "useRuleTester" }] },
		],
	},
);

new RuleTester().run(
	"require-rule-tester (with RuleTester)",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(requireRuleTesterRule) as never,
	{
		valid: [
			{
				code: `import { RuleTester } from "oxlint/plugins-dev";\nnew RuleTester().run("x", rule, {});`,
				filename: "rules/foo.test.ts",
			},
		],
		invalid: [],
	},
);
