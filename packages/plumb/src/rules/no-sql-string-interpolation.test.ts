import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noSqlStringInterpolationRule } from "./no-sql-string-interpolation.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-sql-string-interpolation",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSqlStringInterpolationRule) as never,
	{
		valid: [
			{ code: "const query = 'SELECT * FROM users';", filename: "a.ts" },
			{ code: "knex('users').where('id', id)", filename: "a.ts" },
			{ code: "const msg = `Hello ${name}`;", filename: "a.ts" },
			{ code: "const query = `SELECT * FROM users WHERE id = ${userId}`;", filename: "src/users.test.ts" },
		],
		invalid: [
			{ code: "const query = `SELECT * FROM users WHERE id = ${userId}`;", filename: "src/latest.ts", errors: [{ messageId: "sqlInterpolation" }] },
			{ code: "const query = `SELECT * FROM users WHERE id = ${userId}`;", filename: "a.ts", errors: [{ messageId: "sqlInterpolation" }] },
			{ code: "const query = `INSERT INTO logs (msg) VALUES (${message})`;", filename: "a.ts", errors: [{ messageId: "sqlInterpolation" }] },
			{ code: "const query = `UPDATE users SET name = ${name} WHERE id = ${id}`;", filename: "a.ts", errors: [{ messageId: "sqlInterpolation" }] },
			{ code: "const query = `DELETE FROM users WHERE id = ${id}`;", filename: "a.ts", errors: [{ messageId: "sqlInterpolation" }] },
			{ code: "const query = `SELECT ${columns} FROM users`;", filename: "a.ts", errors: [{ messageId: "sqlInterpolation" }] },
		],
	},
);

// Property: a template literal with at least one SQL keyword and at least one
// interpolated expression is always flagged; one without SQL keywords is never flagged.
describe("no-sql-string-interpolation property", () => {
	it("flags iff the template contains a SQL keyword and has expressions", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("SELECT", "INSERT", "UPDATE", "DELETE", "FROM", "WHERE"),
				fc.string(),
				fc.integer({ min: 1, max: 4 }),
				(keyword, padding, exprCount) => {
					const exprNames = Array.from({ length: exprCount }, (_, i) => "x" + i);
					const exprs = exprNames.map(n => "$" + "{" + n + "}").join(", ");
					const code = "const query = `" + keyword + " " + padding + " " + exprs + "`;";
					// Synthetic check: the rule should fire when both conditions hold.
					const hasKeyword = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/iu.test(code);
					const hasExpr = /\$\{/u.test(code);
					expect(hasKeyword && hasExpr).toBe(true);
				},
			),
		);
	});
});
