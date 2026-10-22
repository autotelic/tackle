import { defineRule } from "@oxlint/plugins";
/** Packages whose rows arrive with the driver's own static types. */
const DATA_PACKAGES = new Set([
    "@prisma/client",
    "better-sqlite3",
    "drizzle-orm",
    "knex",
    "kysely",
    "mongodb",
    "mysql",
    "mysql2",
    "pg",
    "postgres",
    "prisma",
    "sequelize",
    "slonik",
    "sqlite3",
    "typeorm",
]);
/** Names that are a coercion of a row value, not a conversion of a request field. */
const COERCIONS = new Set(["Number", "parseFloat", "parseInt"]);
/**
 * Roots that name transport input rather than a row.
 *
 * `Number(query.year)` converts a search parameter, which is the boundary doing
 * its job. The candidate filter drops it here so the expected ignore is not
 * needed; anything else with a member expression is a row until proven
 * otherwise.
 */
const TRANSPORT_ROOTS = new Set(["body", "form", "options", "params", "query", "req", "request", "searchParams"]);
/** Whether an imported specifier means this module reads rows.
 *
 * @param {string} specifier - The import specifier.
 * @returns {boolean} True for a query builder, a driver or an internal query path.
 */
function readsRows(specifier) {
    const parts = specifier.split("/");
    const [first, second] = parts;
    const packageName = first?.startsWith("@") === true && second !== undefined ? `${first}/${second}` : first;
    if (packageName !== undefined && DATA_PACKAGES.has(packageName))
        return true;
    if (!specifier.startsWith(".") && !specifier.startsWith("/"))
        return false;
    return specifier
        .replaceAll("\\", "/")
        .split("/")
        .some((segment) => segment === "db" || segment === "database" || segment === "queries" || segment === "query");
}
/**
 * Whether a member expression's root names transport input rather than a row.
 *
 * @param {string} name - The root identifier.
 * @returns {boolean} True when the root is a request, a query or a body.
 */
export function isTransportRoot(name) {
    return TRANSPORT_ROOTS.has(name);
}
/** The identifier a member expression starts at.
 *
 * @param {ESTree.Expression} expression - The expression to walk down.
 * @returns {string | null} The root name, or null when the root is computed.
 */
function rootName(expression) {
    let current = expression;
    for (let guard = 0; guard < 16; guard += 1) {
        if (current.type === "Identifier")
            return current.name;
        if (current.type !== "MemberExpression")
            return null;
        current = current.object;
    }
    return null;
}
/**
 * A number read out of a row is text from the driver until something decodes
 * it. `Number(row.amount)` is a second implementation of the domain's schema,
 * with its own failure: `NaN` instead of a decode error.
 */
export const noRowCoercionRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow Number/parseInt/parseFloat coercion of a row member expression in a module that reads the database; decode through the domain schema instead.",
        },
        messages: {
            rowCoercion: "`{{callee}}({{member}})` trusts the driver's text to be a number. Decode it through the domain schema, so the conversion has one implementation and one failure.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    paths: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
            },
        ],
        defaultOptions: [{}],
    },
    createOnce(context) {
        let readsDatabase = false;
        function checkImport(node) {
            if (readsRows(node.source.value))
                readsDatabase = true;
        }
        function checkCall(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "knex")
                readsDatabase = true;
            if (!readsDatabase)
                return;
            if (node.callee.type !== "Identifier" || !COERCIONS.has(node.callee.name))
                return;
            const first = node.arguments[0];
            if (first === undefined || first.type !== "MemberExpression")
                return;
            const root = rootName(first);
            if (root === null || isTransportRoot(root))
                return;
            context.report({
                node,
                messageId: "rowCoercion",
                data: {
                    callee: node.callee.name,
                    member: context.sourceCode.text.slice(first.start, first.end),
                },
            });
        }
        return {
            before() {
                readsDatabase = false;
            },
            ImportDeclaration: checkImport,
            CallExpression: checkCall,
        };
    },
});
