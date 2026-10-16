import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);
/**
 * Whether the expression is a literal operand (literal or brace-less template).
 *
 * @param {ESTree.Node} node - The candidate expression node.
 * @returns {boolean} True when the node is literal-valued.
 */
function isLiteral(node) {
    if (node.type === "Literal")
        return true;
    return node.type === "TemplateLiteral" && node.expressions.length === 0;
}
/**
 * The compared operand of a literal equality test, rendered to source text.
 *
 * @param {import("@oxlint/plugins").SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Expression} test - The conditional's test expression.
 * @returns {string | undefined} Source text of the non-literal side, or undefined.
 */
function comparedValue(sourceCode, test) {
    if (test.type !== "BinaryExpression")
        return undefined;
    if (!EQUALITY_OPERATORS.has(test.operator))
        return undefined;
    if (isLiteral(test.left))
        return sourceCode.getText(test.right);
    if (isLiteral(test.right))
        return sourceCode.getText(test.left);
    return undefined;
}
/** Chained literal ternaries over one value re-implement `Match` without exhaustiveness checking. */
export const preferEffectMatchRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Prefer Match from effect for chained literal ternaries over the same value; the compiler then checks exhaustiveness instead of falling through silently.",
        },
        messages: {
            preferMatch: "This ternary chain re-implements pattern matching over literal comparisons. Use `Match.value` (or `Match.discriminate`) from `effect/Match` so exhaustiveness is checked by the compiler.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ConditionalExpression(node) {
                const parent = ancestorsOf(context.sourceCode, node)[0];
                if (parent?.type === "ConditionalExpression") {
                    return;
                }
                const compared = comparedValue(context.sourceCode, node.test);
                if (compared === undefined)
                    return;
                let alternate = node.alternate;
                let literalChecks = 1;
                while (alternate.type === "ConditionalExpression") {
                    const alternateCompared = comparedValue(context.sourceCode, alternate.test);
                    if (alternateCompared !== compared)
                        return;
                    literalChecks += 1;
                    alternate = alternate.alternate;
                }
                if (literalChecks > 1) {
                    context.report({ node, messageId: "preferMatch" });
                }
            },
        };
    },
});
