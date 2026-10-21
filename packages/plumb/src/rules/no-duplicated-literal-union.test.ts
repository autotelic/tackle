import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { ESTree } from "@oxlint/plugins";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { literalUnionKey, noDuplicatedLiteralUnionRule } from "./no-duplicated-literal-union.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-duplicated-literal-union",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noDuplicatedLiteralUnionRule) as never,
	{
		valid: [
			{ code: `type A = "x" | "y";`, filename: "a.ts" },
			{ code: `type B = "x" | "y";`, filename: "b.ts" },
			{ code: `type A = "x" | "y"; type B = "x" | "z";`, filename: "a.ts" },
		],
		invalid: [
			{
				code: `type C = "x" | "y"; type D = "y" | "x";`,
				filename: "c.ts",
				errors: [{ messageId: "duplicateUnion", data: { first: "C", second: "D" } }],
			},
		],
	},
);

// Property: the key is the sorted member set, so two unions that list the same
// members in a different order share one key and a union missing a member does not.
describe("no-duplicated-literal-union property", () => {
	it("keys a literal union by its sorted members, order-independently", () => {
		fc.assert(
			fc.property(fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 4 }), (members) => {
				const annotation = {
					type: "TSUnionType",
					types: members.map((value) => ({
						type: "TSLiteralType",
						literal: { type: "Literal", value },
					})),
				};
				// SAFETY: the object above is the minimal ESTree shape `literalUnionKey`
				// reads (a union of literal nodes); the cast bridges the test's literal to
				// the full node type the rule is declared against.
				const key = literalUnionKey(annotation as unknown as ESTree.TSType);
				expect(key).toEqual([...members].sort((left, right) => left.localeCompare(right)));
			}),
		);
	});
});
