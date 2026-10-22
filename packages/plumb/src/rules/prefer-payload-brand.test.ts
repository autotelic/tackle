import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { preferPayloadBrandRule } from "./prefer-payload-brand.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"prefer-payload-brand",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(preferPayloadBrandRule) as never,
	{
		valid: [
			{ code: `type UserId = string & Brand.Brand<"UserId">;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `interface UserId extends Brand.Brand {}`, filename: "a.ts", errors: [{ messageId: "opaqueBrand" }] },
		],
	},
);
