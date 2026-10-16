import { defineRule } from "@oxlint/plugins";
import { getAllComments } from "../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Every exported function carries a complete JSDoc contract. */
export const requireJsdocOnExportedRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require exported functions (declarations and arrow/function-expression consts) to carry an attached JSDoc block; the jsdoc rules only check blocks that exist, so undocumented exports otherwise escape the contract rules entirely.",
        },
        messages: {
            missingJsdoc: "Exported function `{{name}}` has no JSDoc block. Document the contract with @param/@returns so the jsdoc rules can enforce it.",
        },
    },
    createOnce(context) {
        const jsdocFollowsLines = new Set();
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
                jsdocFollowsLines.clear();
            },
            Program(node) {
                jsdocFollowsLines.clear();
                for (const comment of getAllComments(context.sourceCode)) {
                    if (comment.type !== "Block" || !comment.value.startsWith("*"))
                        continue;
                    const endLine = comment.loc?.end?.line;
                    if (endLine !== undefined)
                        jsdocFollowsLines.add(endLine + 1);
                }
            },
            ExportNamedDeclaration(node) {
                const declaration = node.declaration;
                if (declaration === null || declaration === undefined)
                    return;
                const startLine = declaration.loc?.start?.line;
                if (startLine === undefined || jsdocFollowsLines.has(startLine))
                    return;
                if (declaration.type === "FunctionDeclaration" && declaration.id !== null) {
                    context.report({
                        node: declaration,
                        messageId: "missingJsdoc",
                        data: { name: declaration.id.name },
                    });
                    return;
                }
                if (declaration.type !== "VariableDeclaration")
                    return;
                for (const declarator of declaration.declarations) {
                    if (declarator.id.type !== "Identifier")
                        continue;
                    const init = declarator.init;
                    if (init?.type === "ArrowFunctionExpression" ||
                        init?.type === "FunctionExpression") {
                        context.report({
                            node: declarator.id,
                            messageId: "missingJsdoc",
                            data: { name: declarator.id.name },
                        });
                    }
                }
            },
        };
    },
});
