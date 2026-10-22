import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noNestedLayerProvideRule } from "./no-nested-layer-provide.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-nested-layer-provide",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noNestedLayerProvideRule) as never,
	{
		valid: [
			{ code: `const x = Layer.provide(a);`, filename: "a.ts" },
		],
		invalid: [
			{ code: `const x = Layer.provide(Layer.provide(a, b));`, filename: "a.ts", errors: [{ messageId: "nestedProvide" }] },
		],
	},
);
