import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noReinterpretCastRule } from "./no-reinterpret-cast.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-reinterpret-cast",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noReinterpretCastRule) as never,
	{
		valid: [
			{ code: `const x = y as const;`, filename: "a.ts" },
			{ code: `const x = /* SAFETY: verified upstream */ y as string;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = y as string;`, filename: "a.ts", errors: [{ messageId: "noReinterpret" }] },
		],
	},
);
