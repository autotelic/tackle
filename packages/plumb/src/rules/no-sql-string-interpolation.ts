import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * SQL keywords that suggest a string is a query. Case-insensitive match
 * against the raw template string portions.
 */
const SQL_KEYWORDS: ReadonlyArray<string> = [
	"SELECT",
	"INSERT",
	"UPDATE",
	"DELETE",
	"FROM",
	"WHERE",
	"JOIN",
	"CREATE\\s+TABLE",
	"DROP\\s+TABLE",
	"ALTER\\s+TABLE",
];

/**
 * Keywords that can only mean SQL.
 *
 * `FROM` is left out on purpose. It is an ordinary English preposition, so a
 * message like "two declarations from different files" matched the keyword list
 * and the rule read a prose sentence as a query. A query that uses FROM names a
 * verb beside it (SELECT, DELETE, INSERT, UPDATE), so the bare preposition loses
 * no query and the false positive is narrowed here rather than exempted for the
 * whole file.
 */
const CLAUSE_KEYWORDS: ReadonlyArray<string> = SQL_KEYWORDS.filter(
	(keyword) => keyword !== "FROM",
);

const CLAUSE_PATTERN = new RegExp(
	"\\b(?:" + CLAUSE_KEYWORDS.join("|") + ")\\b",
	"iu",
);

/**
 * Whether a template literal's raw text names a SQL clause.
 * @param {ESTree.TemplateElement} quasi - The template element to test.
 * @returns {boolean} True when the raw text names a SQL clause.
 */
function hasSqlKeyword(quasi: ESTree.TemplateElement): boolean {
	return CLAUSE_PATTERN.test(quasi.value.raw);
}

/**
 * Disallow SQL queries built from template literal interpolation. String
 * interpolation in SQL is an injection vector: attacker-controlled values
 * become query structure. Use parameterized queries or a query builder
 * instead so values never become syntax.
 */
export const noSqlStringInterpolationRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow SQL queries built via template literal interpolation; use parameterized queries or a query builder to prevent SQL injection.",
		},
		messages: {
			sqlInterpolation:
				"SQL via template literal interpolation is an injection vector. Use parameterized queries or a query builder so values never become syntax.",
		},
	},
	createOnce(context) {
		return {
			before() {
				if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			TemplateLiteral(node) {
				if (node.expressions.length === 0) return;
				for (const quasi of node.quasis) {
					if (hasSqlKeyword(quasi)) {
						context.report({ node, messageId: "sqlInterpolation" });
						return;
					}
				}
			},
		};
	},
});
