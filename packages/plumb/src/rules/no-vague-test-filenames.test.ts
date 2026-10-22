import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noVagueTestFilenamesRule } from "./no-vague-test-filenames.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-vague-test-filenames",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noVagueTestFilenamesRule) as never,
	{
		valid: [
			{ code: `const x = 1;`, filename: "users.test.ts" },
		],
		invalid: [
			{ code: `const x = 1;`, filename: "utils.test.ts", errors: [{ messageId: "vagueTestFilename" }] },
		],
	},
);
