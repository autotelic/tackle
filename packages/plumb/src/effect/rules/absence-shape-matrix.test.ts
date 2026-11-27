import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { guardedOpMustReturnEffectRule } from "./guarded-op-must-return-effect.ts";
import { guardedOpMustReturnOptionRule } from "./guarded-op-must-return-option.ts";

wireRuleTester({ describe, it });

/**
 * Both absence rules over the three ways to spell "no answer". Only Either passes
 * both; the pair used to send a reader from one rejected shape to the other.
 */
const CASES = [
	{
		code: `export function findUser(id: string): string | undefined { return undefined; }`,
		rejectedBy: { option: "nullableReturn", effect: null },
	},
	{
		code: `export function findUser(id: string): Option.Option<string> { return Option.some(id); }`,
		rejectedBy: { option: null, effect: "optionReturn" },
	},
	{
		code: `export function findUser(id: string): Either.Either<string, Reason> { return Either.right("x"); }`,
		rejectedBy: { option: null, effect: null },
	},
] as const;

const RULES = [
	{ name: "guarded-op-must-return-option", rule: guardedOpMustReturnOptionRule, column: "option" },
	{ name: "guarded-op-must-return-effect", rule: guardedOpMustReturnEffectRule, column: "effect" },
] as const;

for (const { name, rule, column } of RULES) {
	new RuleTester().run(
		`${name} over the absence matrix`,
		// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
		// is the adapter's documented purpose.
		testableRule(rule) as never,
		{
			valid: CASES.filter((shape) => shape.rejectedBy[column] === null).map((shape) => ({
				code: shape.code,
				filename: "a.ts",
			})),
			invalid: CASES.flatMap((shape) => {
				const messageId = shape.rejectedBy[column];
				return messageId === null
					? []
					: [{ code: shape.code, filename: "a.ts", errors: [{ messageId }] }];
			}),
		},
	);
}
