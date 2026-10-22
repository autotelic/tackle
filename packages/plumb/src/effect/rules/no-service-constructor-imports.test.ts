import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noServiceConstructorImportsRule } from "./no-service-constructor-imports.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-service-constructor-imports",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noServiceConstructorImportsRule) as never,
	{
		valid: [
			{ code: `import { UserService } from "./user.ts";`, filename: "a.ts" },
			{ code: `import { makeUserService } from "./user.ts";`, filename: "a.test.ts" },
		],
		invalid: [
			{ code: `import { makeUserService } from "./user.ts";`, filename: "a.ts", errors: [{ messageId: "serviceConstructorImport" }] },
		],
	},
);
