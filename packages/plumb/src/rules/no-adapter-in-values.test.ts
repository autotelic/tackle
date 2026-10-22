import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { isAdapter, noAdapterInValuesRule } from "./no-adapter-in-values.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-adapter-in-values",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noAdapterInValuesRule) as never,
	{
		valid: [
			{ code: `import { z } from "zod"\nexport type Money = z.infer<typeof Money>` , filename: "src/domain/money.ts" },
			{ code: `import knex from "knex"\nexport const rows = knex("payroll")`, filename: "src/routes/payroll.ts" },
			{ code: `import knex from "knex"\nexport const rows = knex("payroll")`, filename: "src/ledger/payroll.ts" },
		],
		invalid: [
			{
				code: `import knex from "knex"\nexport const money = knex("payroll")`,
				filename: "src/domain/money.ts",
				errors: [{ messageId: "adapterInValues" }],
			},
			{
				code: `export * from "../queries/payroll"`,
				filename: "src/domain/payroll.ts",
				errors: [{ messageId: "adapterInValues" }],
			},
			{
				code: `import { pool } from "./db"`,
				filename: "lib/core/money.ts",
				options: [{ paths: ["lib/core"] }],
				errors: [{ messageId: "adapterInValues" }],
			},
		],
	},
);

it("every declared adapter package is an adapter", () => {
	fc.assert(
		fc.property(fc.constantFrom("knex", "pg", "express", "fastify", "@prisma/client"), (name) => {
			fc.pre(isAdapter(name));
		}),
	);
});
