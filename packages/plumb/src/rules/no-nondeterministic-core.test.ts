import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noNondeterministicCoreRule } from "./no-nondeterministic-core.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-nondeterministic-core",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noNondeterministicCoreRule) as never,
	{
		valid: [
			{ code: `const d = new Date(0);`, filename: "a.ts" },
			{ code: `const r = Math.random();`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `const r = Math.random();`, filename: "a.ts", errors: [{ messageId: "nondeterministicSource" }] },
			{ code: `const t = Date.now();`, filename: "a.ts", errors: [{ messageId: "nondeterministicSource" }] },
			{ code: `const d = new Date();`, filename: "a.ts", errors: [{ messageId: "unseededDate" }] },
		],
	},
);
