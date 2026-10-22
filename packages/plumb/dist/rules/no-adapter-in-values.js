import { defineRule } from "@oxlint/plugins";
import { inValuesPath } from "../shared/values-path.js";
/**
 * Packages that put a value on a database, a socket or a request.
 *
 * A DECLARED vocabulary, like the `node:` builtins in `dependency-fit`: which
 * driver a repository chose is a fact about the adapter, and the packages that
 * can be one are a closed list. A repository with an in-house client adds its
 * path to the rule's `paths` option rather than teaching the rule a new name.
 */
const ADAPTER_PACKAGES = new Set([
    "@hapi/hapi",
    "@nestjs/common",
    "@prisma/client",
    "better-sqlite3",
    "drizzle-orm",
    "express",
    "fastify",
    "hono",
    "knex",
    "koa",
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
/** Path fragments that name an adapter or a query module inside the repository. */
const ADAPTER_PATH_SEGMENTS = new Set(["adapter", "adapters", "db", "database", "queries", "query", "repository", "repositories"]);
/** The package a specifier names, so `knex/lib/query` is still `knex`.
 *
 * @param {string} specifier - An import specifier.
 * @returns {string} The package name, or the specifier when it is relative.
 */
function packageOf(specifier) {
    const parts = specifier.split("/");
    const [first, second] = parts;
    if (first === undefined)
        return specifier;
    return first.startsWith("@") && second !== undefined ? `${first}/${second}` : first;
}
/** Whether an import is a cost-driven dependency the values stratum may not hold.
 *
 * @param {string} specifier - The import specifier.
 * @returns {boolean} True when it is a query builder, a driver or an adapter path.
 */
export function isAdapter(specifier) {
    if (ADAPTER_PACKAGES.has(packageOf(specifier)))
        return true;
    if (!specifier.startsWith(".") && !specifier.startsWith("/"))
        return false;
    const segments = specifier.replaceAll("\\", "/").split("/");
    return segments.some((segment) => ADAPTER_PATH_SEGMENTS.has(segment));
}
/**
 * The values stratum depends on nothing internal. A `Money` that can import the
 * query builder is not a value: it is a row with a reassuring name, and the
 * next author will put a `where` clause in it.
 */
export const noAdapterInValuesRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow imports of query builders, database drivers, HTTP frameworks and query modules from a declared values path.",
        },
        messages: {
            adapterInValues: "`{{specifier}}` belongs to the adapter, not to a value. The domain depends on nothing internal: move this import to the derivation or edge that reads it.",
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
        function check(specifier, node) {
            if (specifier === null || specifier === undefined)
                return;
            if (!isAdapter(specifier))
                return;
            context.report({ node, messageId: "adapterInValues", data: { specifier } });
        }
        return {
            before() {
                if (!inValuesPath(context.filename, context.options))
                    return false;
            },
            ImportDeclaration(node) {
                check(node.source.value, node);
            },
            ExportAllDeclaration(node) {
                check(node.source.value, node);
            },
            ExportNamedDeclaration(node) {
                check(node.source?.value, node);
            },
        };
    },
});
