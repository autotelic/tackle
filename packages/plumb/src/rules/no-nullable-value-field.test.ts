import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { hasAbsence, noNullableValueFieldRule } from "./no-nullable-value-field.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-nullable-value-field",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noNullableValueFieldRule) as never,
	{
		valid: [
			{
				code: `import { Schema } from "effect"\nexport const Money = Schema.Struct({ amount: Schema.Number })`,
				filename: "src/domain/money.ts",
			},
			{
				code: `import { Schema } from "effect"\nexport const Row = Schema.Struct({ amount: Schema.NullOr(Schema.Number) })`,
				filename: "src/rows/money.ts",
			},
		],
		invalid: [
			{
				code: `import { Schema } from "effect"\nexport const Money = Schema.Struct({ amount: Schema.NullOr(Schema.Number) })`,
				filename: "src/domain/money.ts",
				errors: [{ messageId: "nullableValueField" }],
			},
			{
				code: `import { Schema } from "effect"\nexport const Money = Schema.Struct({ note: Schema.optionalKey(Schema.String) })`,
				filename: "packages/domain/src/money.ts",
				errors: [{ messageId: "nullableValueField" }],
			},
		],
	},
);

it("a chain containing an absence constructor admits absence", () => {
	fc.assert(
		fc.property(
			fc.constantFrom("NullOr", "UndefinedOr", "optionalKey"),
			fc.array(fc.string()),
			(absence, rest) => {
				fc.pre(hasAbsence([absence, ...rest]));
			},
		),
	);
});
