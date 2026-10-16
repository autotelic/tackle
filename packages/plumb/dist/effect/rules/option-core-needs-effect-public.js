import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** The exported name declared by this statement, if any.
 *
 * @param {ESTree.Node} node - The export or declaration statement.
 * @returns {string | null} The declared binding name, or null when anonymous.
 */
function exportedName(node) {
    if (node.type === "ExportNamedDeclaration") {
        const declaration = node.declaration;
        if (declaration === null || declaration === undefined)
            return null;
        if (declaration.type === "FunctionDeclaration" && declaration.id !== null) {
            return declaration.id.name;
        }
        if (declaration.type === "VariableDeclaration") {
            for (const declarator of declaration.declarations) {
                if (declarator.id.type === "Identifier")
                    return declarator.id.name;
            }
        }
    }
    return null;
}
/**
 * Every exported `*Option` guarded core must have a converted public twin in the
 * same module, so Option-shaped internals cannot silently become the public API.
 */
export const optionCoreNeedsEffectPublicRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require every exported *Option guarded core to be paired with a converted public API that owns the typed error channel.",
        },
        messages: {
            missingTwin: "`{{name}}` collapses failures to `Option.none()` with no converted public twin. Export `{{base}}` returning `Effect.Effect<T, MoneyError>` (or mark the core `@deprecated` if retired), so callers can match Overflow vs InvalidInput vs ZeroDivisor.",
        },
    },
    createOnce(context) {
        const cores = [];
        const exported = new Set();
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
                cores.length = 0;
                exported.clear();
            },
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator, ExportNamedDeclaration > FunctionDeclaration": (node) => {
                const declaratorId = node.type === "VariableDeclarator" ? node.id : null;
                const name = node.type === "FunctionDeclaration"
                    ? (node.id?.name ?? null)
                    : declaratorId?.type === "Identifier"
                        ? declaratorId.name
                        : null;
                if (name === null)
                    return;
                exported.add(name);
                if (name.endsWith("Option")) {
                    cores.push({ node, name, base: name.slice(0, -"Option".length) });
                }
            },
            "Program:exit"() {
                for (const core of cores) {
                    if (!exported.has(core.base)) {
                        context.report({
                            node: core.node,
                            messageId: "missingTwin",
                            data: { name: core.name, base: core.base },
                        });
                    }
                }
            },
        };
    },
});
