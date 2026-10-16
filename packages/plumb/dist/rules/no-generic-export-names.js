import { defineRule } from "@oxlint/plugins";
/** Single words whose bare grep hits span unrelated subsystems (the `create` problem). */
const GENERIC_TERMS = new Set([
    "create",
    "init",
    "initialize",
    "get",
    "set",
    "validate",
    "process",
    "handle",
    "run",
    "make",
    "build",
    "execute",
    "update",
    "parse",
    "format",
    "convert",
    "transform",
    "start",
    "stop",
    "load",
    "save",
    "check",
    "do",
    "main",
    "util",
    "utils",
    "helper",
    "helpers",
    "misc",
    "common",
    "data",
    "manager",
    "service",
    "wrapper",
    "temp",
    "tmp",
]);
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Split an identifier into its words across camelCase and separators.
 *
 * @param {string} name - Identifier or filename stem to split.
 * @returns {Array<string>} Non-empty words of the name.
 */
function splitWords(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .split(/[^A-Za-z0-9]+/u)
        .filter((word) => word.length > 0);
}
/** Module segment acting as the qualification prefix at qualified call sites.
 *
 * @param {string} filename - Lint-context filename of the module.
 * @returns {Array<string>} Words of the module's qualifying segment.
 */
function qualifierWords(filename) {
    const segments = filename.replaceAll("\\", "/").split("/");
    const base = segments[segments.length - 1] ?? "";
    let stem = base.replace(/\.[cm]?[jt]sx?$/u, "");
    if (stem === "index" || stem === "mod") {
        stem = segments[segments.length - 2] ?? stem;
    }
    return splitWords(stem);
}
/** True when every word of the name is generic, so qualification adds nothing either.
 *
 * @param {Array<string>} words - Words of the exported symbol's name.
 * @returns {boolean} True when no word carries domain meaning.
 */
function isAllGeneric(words) {
    return (words.length > 0 &&
        words.every((word) => GENERIC_TERMS.has(word.toLowerCase())));
}
/** Exported symbols must resolve by grep in one hop; qualification by the module counts. */
export const noGenericExportNamesRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow exported symbol names that stay generic even after module qualification (e.g. utils.ts exporting `create`); a distinctive qualified token such as `Currency.make` greps to exactly the right definition and call sites.",
        },
        messages: {
            genericExportName: "Exported symbol `{{qualified}}` stays generic, so searching it lands on hundreds of unrelated hits. Add a domain word to the name (e.g. `create` -> `createStripeClient`) or move it into a domain-named module so callers read `{{domain}}.{{name}}`.",
        },
    },
    createOnce(context) {
        let moduleWords = [];
        let moduleSuppliesDomain = false;
        return {
            before() {
                const filePath = context.filename.replaceAll("\\", "/");
                if (TEST_FILE.test(filePath))
                    return false;
                moduleWords = qualifierWords(filePath);
                moduleSuppliesDomain = moduleWords.some((word) => !GENERIC_TERMS.has(word.toLowerCase()));
            },
            Program(node) {
                for (const statement of node.body) {
                    const declaration = statement.type === "ExportNamedDeclaration" ||
                        statement.type === "ExportDefaultDeclaration"
                        ? (statement.declaration ?? null)
                        : statement;
                    if (declaration === null)
                        continue;
                    const identifiers = [];
                    if (declaration.type === "FunctionDeclaration" ||
                        declaration.type === "ClassDeclaration" ||
                        declaration.type === "TSInterfaceDeclaration" ||
                        declaration.type === "TSTypeAliasDeclaration" ||
                        declaration.type === "TSEnumDeclaration") {
                        if (declaration.id !== null)
                            identifiers.push(declaration.id);
                    }
                    else if (declaration.type === "VariableDeclaration") {
                        for (const declarator of declaration.declarations) {
                            if (declarator.id.type === "Identifier")
                                identifiers.push(declarator.id);
                        }
                    }
                    for (const id of identifiers) {
                        const nameWords = splitWords(id.name);
                        if (!isAllGeneric(nameWords))
                            continue;
                        if (moduleSuppliesDomain)
                            continue;
                        context.report({
                            node: id,
                            messageId: "genericExportName",
                            data: {
                                name: id.name,
                                qualified: moduleWords.concat(nameWords).join("."),
                                domain: moduleWords.join(""),
                            },
                        });
                    }
                }
            },
        };
    },
});
