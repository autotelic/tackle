import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
/**
 * SQL keywords that suggest a string is a query. Case-insensitive match
 * against the raw template string portions.
 */
const SQL_KEYWORDS = [
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
const SQL_PATTERN = new RegExp("\\b(?:" + SQL_KEYWORDS.join("|") + ")\\b", "iu");
/**
 * Whether a template literal's raw text contains a SQL keyword.
 * @param {ESTree.TemplateElement} quasi - The template element to test.
 * @returns {boolean} True when the raw text contains a SQL keyword.
 */
function hasSqlKeyword(quasi) {
    return SQL_PATTERN.test(quasi.value.raw);
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
            description: "Disallow SQL queries built via template literal interpolation; use parameterized queries or a query builder to prevent SQL injection.",
        },
        messages: {
            sqlInterpolation: "SQL via template literal interpolation is an injection vector. Use parameterized queries or a query builder so values never become syntax.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            TemplateLiteral(node) {
                if (node.expressions.length === 0)
                    return;
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
