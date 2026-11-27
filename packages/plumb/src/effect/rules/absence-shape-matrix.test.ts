import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { guardedOpMustReturnEffectRule } from "./guarded-op-must-return-effect.ts";
import { guardedOpMustReturnOptionRule } from "./guarded-op-must-return-option.ts";

wireRuleTester({ describe, it });

/**
 * The negative fixture `docs/rules-to-write.md` asks for: the three ways to spell
 * absence, run through BOTH rules.
 *
 * The pair used to tell a reader to move from one column to the next and then
 * rejected the destination, so no single shape satisfied both:
 *
 *   return shape             | guarded-op-must-return-option | guarded-op-must-return-effect | both pass
 *   -------------------------|-------------------------------|-------------------------------|----------
 *   `string | undefined`     | fails (nullableReturn)        | passes                        | no
 *   `Option<string>`         | passes                        | fails (optionReturn/bareNone) | no
 *   `Either<string, Reason>` | passes                        | passes                        | yes
 *
 * Only `Either<T, TaggedReason>` survives both, and it is the shape both
 * messages now name. If a future change makes Option acceptable again, this
 * matrix turns red rather than leaving the contradiction to be discovered in a
 * factory pass.
 */
const NULLABLE = `export function findUser(id: string): string | undefined { return undefined; }`;
const OPTION = `export function findUser(id: string): Option.Option<string> { return Option.some(id); }`;
const EITHER = `export function findUser(id: string): Either.Either<string, Reason> { return Either.right("x"); }`;

const optionTester = new RuleTester();

optionTester.run(
	"guarded-op-must-return-option over the absence matrix",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(guardedOpMustReturnOptionRule) as never,
	{
		valid: [
			{ code: OPTION, filename: "a.ts" },
			{ code: EITHER, filename: "a.ts" },
		],
		invalid: [
			{
				code: NULLABLE,
				filename: "a.ts",
				errors: [{ messageId: "nullableReturn" }],
			},
		],
	},
);

const effectTester = new RuleTester();

effectTester.run(
	"guarded-op-must-return-effect over the absence matrix",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(guardedOpMustReturnEffectRule) as never,
	{
		valid: [
			{ code: NULLABLE, filename: "a.ts" },
			{ code: EITHER, filename: "a.ts" },
		],
		invalid: [
			{
				code: OPTION,
				filename: "a.ts",
				errors: [{ messageId: "optionReturn" }],
			},
		],
	},
);
