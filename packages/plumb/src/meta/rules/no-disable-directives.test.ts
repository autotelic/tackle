import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noDisableDirectivesRule } from "./no-disable-directives.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-disable-directives",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDisableDirectivesRule) as never,
	{
		valid: [
			{ code: `const x = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `// oxlint-disable no-console\nconst x = 1;`, filename: "a.ts", errors: [{ messageId: "suppressionDirective" }] },
		],
	},
);
