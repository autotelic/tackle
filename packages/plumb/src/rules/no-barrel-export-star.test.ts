import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noBarrelExportStarRule } from "./no-barrel-export-star.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-barrel-export-star",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noBarrelExportStarRule) as never,
	{
		valid: [
			{ code: `export { a } from "./a.ts";`, filename: "a.ts" },
			{ code: `export * as ns from "./a.ts";`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export * from "./a.ts";`, filename: "a.ts", errors: [{ messageId: "erasesForwardedNames" }] },
		],
	},
);
