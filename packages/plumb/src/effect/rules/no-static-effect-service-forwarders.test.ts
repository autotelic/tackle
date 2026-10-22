import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noStaticEffectServiceForwardersRule } from "./no-static-effect-service-forwarders.ts";

wireRuleTester({ describe, it });

// The static-field case is the rule's whole point. It was unreachable until the
// `inStaticClassField` guard walked the chain nearest-first (`ancestorsOf` is
// outermost-first, so `Program` came first and the walk always stopped there).
const tester = new RuleTester();

tester.run(
	"no-static-effect-service-forwarders",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noStaticEffectServiceForwardersRule) as never,
	{
		valid: [
			{
				code: `import { Effect } from "effect";\nclass Svc { find = Effect.flatMap(Effect.service(this), (svc) => svc.find); }`,
				filename: "a.ts",
			},
		],
		invalid: [
			{
				code: `import { Effect } from "effect";\nclass Svc { static find = Effect.flatMap(Effect.service(this), (svc) => svc.find); }`,
				filename: "a.ts",
				errors: [{ messageId: "staticForwarder" }],
			},
		],
	},
);
