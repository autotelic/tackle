import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noDirectBrowserStorageRule } from "./no-direct-browser-storage.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-direct-browser-storage",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDirectBrowserStorageRule) as never,
	{
		valid: [
			{ code: `const x = store.get("k");`, filename: "a.ts" },
		],
		invalid: [
			{ code: `localStorage;`, filename: "a.ts", errors: [{ messageId: "directStorage" }] },
			{ code: `const x = window.sessionStorage;`, filename: "a.ts", errors: [{ messageId: "directStorage" }] },
		],
	},
);
