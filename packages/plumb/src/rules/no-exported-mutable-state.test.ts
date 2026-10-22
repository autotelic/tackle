import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noExportedMutableStateRule } from "./no-exported-mutable-state.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-exported-mutable-state",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noExportedMutableStateRule) as never,
	{
		valid: [
			{ code: `export const x = 1;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `export let x = 1;`, filename: "a.ts", errors: [{ messageId: "exportedBinding" }] },
			{ code: `let x = 1; x = 2;`, filename: "a.ts", errors: [{ messageId: "moduleMutation" }] },
			{ code: `const list = []; list.push(1);`, filename: "a.ts", errors: [{ messageId: "moduleMutation" }] },
		],
	},
);
