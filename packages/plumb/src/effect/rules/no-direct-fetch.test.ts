import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noDirectFetchRule } from "./no-direct-fetch.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-direct-fetch",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDirectFetchRule) as never,
	{
		valid: [
			{ code: `client.get("/api");`, filename: "a.ts" },
		],
		invalid: [
			{ code: `fetch("/api");`, filename: "a.ts", errors: [{ messageId: "directFetch" }] },
			{ code: `window.fetch("/api");`, filename: "a.ts", errors: [{ messageId: "directFetch" }] },
		],
	},
);
