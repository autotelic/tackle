import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { isTransportRoot, noRowCoercionRule } from "./no-row-coercion.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-row-coercion",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noRowCoercionRule) as never,
	{
		valid: [
			{ code: `const amount = Number(row.amount)`, filename: "src/money.ts" },
			{ code: `import knex from "knex"\nconst year = Number(query.year)`, filename: "src/query.ts" },
		],
		invalid: [
			{
				code: `import knex from "knex"\nexport const read = (row: Row) => Number(row.amount)`,
				filename: "src/query.ts",
				errors: [{ messageId: "rowCoercion" }],
			},
			{
				code: `import { pool } from "./db"\nexport const read = (row: Row) => parseFloat(row.hours)`,
				filename: "src/adapters/payroll.ts",
				errors: [{ messageId: "rowCoercion" }],
			},
			{
				code: `import knex from "knex"\nexport const read = (row: Row) => parseInt(row.year, 10)`,
				filename: "src/query.ts",
				errors: [{ messageId: "rowCoercion" }],
			},
		],
	},
);

it("request roots are transport, not rows", () => {
	fc.assert(
		fc.property(fc.constantFrom("query", "params", "body", "request"), (name) => {
			fc.pre(isTransportRoot(name));
		}),
	);
});
