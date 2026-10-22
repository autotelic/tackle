import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noSilentErrorSwallowRule } from "./no-silent-error-swallow.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-silent-error-swallow",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSilentErrorSwallowRule) as never,
	{
		valid: [
			{ code: `const x = Effect.catch((e) => Effect.fail(e));`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = Effect.catch(() => Effect.void);`, filename: "a.ts", errors: [{ messageId: "silentSwallow" }] },
		],
	},
);
