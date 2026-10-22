import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noUnknownTypeAliasesRule } from "./no-unknown-type-aliases.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-unknown-type-aliases",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noUnknownTypeAliasesRule) as never,
	{
		valid: [
			{ code: `type X = string;`, filename: "a.ts" },
		],
		invalid: [
			{ code: `type X = unknown;`, filename: "a.ts", errors: [{ messageId: "unknownAlias" }] },
			{ code: `type X = unknown; type Y = X;`, filename: "a.ts", errors: [{ messageId: "unknownAlias" }, { messageId: "unknownAlias" }] },
		],
	},
);
