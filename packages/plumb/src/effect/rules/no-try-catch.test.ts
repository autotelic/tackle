import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noTryCatchRule } from "./no-try-catch.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-try-catch",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noTryCatchRule) as never,
	{
		valid: [
			{ code: `// SAFETY: integration boundary\ntry { f(); } catch {}`, filename: "a.ts" },
		],
		invalid: [
			{ code: `try { f(); } catch {}`, filename: "a.ts", errors: [{ messageId: "tryCatch" }] },
		],
	},
);
