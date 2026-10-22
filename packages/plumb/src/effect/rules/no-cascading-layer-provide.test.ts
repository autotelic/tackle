import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noCascadingLayerProvideRule } from "./no-cascading-layer-provide.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-cascading-layer-provide",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noCascadingLayerProvideRule) as never,
	{
		valid: [
			{ code: `import { Layer } from "effect";\nconst x = program.pipe(Layer.provide(A));`, filename: "a.ts" },
		],
		invalid: [
			{ code: `import { Layer } from "effect";\nconst x = program.pipe(Layer.provide(A), Layer.provide(B));`, filename: "a.ts", errors: [{ messageId: "cascadingProvide" }] },
		],
	},
);
