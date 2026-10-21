import { RuleTester } from "oxlint/plugins-dev";

import { describe, it } from "vitest";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noDeprecatedPartsRule } from "./no-deprecated-parts.ts";

wireRuleTester({ describe, it });

const manifest = {
	components: [
		{
			path: "src/components/ui/button.tsx",
			name: "Button",
			exports: ["Button", "ButtonProps"],
			status: "stable",
		},
		{
			path: "src/components/ui/old-button.tsx",
			name: "OldButton",
			exports: ["OldButton"],
			status: "deprecated",
			useInstead: ["Button"],
		},
		{
			path: "src/components/ui/legacy-card.tsx",
			name: "LegacyCard",
			status: "deprecated",
		},
	],
};

new RuleTester().run(
	"no-deprecated-parts",
	testableRule(noDeprecatedPartsRule) as never,
	{
		valid: [
			{
				code: `import { Button } from "@/components/ui/button";`,
				filename: "src/page.tsx",
				options: [{ manifest }],
			},
			{
				// Tests may still reach for the old part while migrating.
				code: `import { OldButton } from "@/components/ui/old-button";`,
				filename: "src/page.test.tsx",
				options: [{ manifest }],
			},
		],
		invalid: [
			{
				code: `import { OldButton } from "@/components/ui/old-button";`,
				filename: "src/page.tsx",
				options: [{ manifest }],
				errors: [{ messageId: "deprecatedImport" }],
			},
			{
				code: `import LegacyCard from "@/components/ui/legacy-card";`,
				filename: "src/page.tsx",
				options: [{ manifest }],
				errors: [{ messageId: "deprecatedWithoutTarget" }],
			},
			{
				code: `import * as LegacyCard from "@/components/ui/legacy-card";`,
				filename: "src/page.tsx",
				options: [{ manifest }],
				errors: [{ messageId: "deprecatedWithoutTarget" }],
			},
		],
	},
);

// A separate suite because `testableRule` deliberately reuses one `createOnce` result,
// as the linter does for one config. A missing manifest is a different config.
new RuleTester().run(
	"no-deprecated-parts with a missing manifest",
	testableRule({ ...noDeprecatedPartsRule }) as never,
	{
		valid: [
			{
				code: `import { OldButton } from "@/components/ui/old-button";`,
				filename: "src/page.tsx",
				options: [{ manifest: "./does-not-exist.json" }],
			},
		],
		invalid: [],
	},
);
