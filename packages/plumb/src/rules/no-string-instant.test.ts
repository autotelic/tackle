import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { namesAnInstant, noStringInstantRule } from "./no-string-instant.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-string-instant",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noStringInstantRule) as never,
	{
		valid: [
			{
				code: `export interface Payment { createdAt: Date; label: string }`,
				filename: "src/domain/payment.ts",
			},
			{
				code: `export interface Payment { createdAt: string }`,
				filename: "src/routes/payment.ts",
			},
		],
		invalid: [
			{
				code: `export interface Payment { createdAt: string }`,
				filename: "src/domain/payment.ts",
				errors: [{ messageId: "stringInstant" }],
			},
			{
				code: `import { Schema as S } from "effect"\nexport const Payment = S.Struct({ paid_at: S.String })`,
				filename: "src/domain/payment.ts",
				errors: [{ messageId: "stringInstant" }],
			},
			{
				code: `export type Wage = { effectiveDate: string }`,
				filename: "src/values/wage.ts",
				errors: [{ messageId: "stringInstant" }],
			},
		],
	},
);

it("any name ending in At names an instant", () => {
	fc.assert(
		fc.property(fc.string(), (name) => {
			fc.pre(namesAnInstant(name + "At"));
		}),
	);
});
