import { defineRule } from "@oxlint/plugins";
import { isRecordObject, isString } from "../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Whether the if-consequent (or alternate) is a bare `throw new Error(...)` assertion.
 *
 * @param {ESTree.Statement | null | undefined} statement - The branch body to inspect.
 * @returns {boolean} True when the branch throws a built-in Error constructor.
 */
function isBuiltinThrowBranch(statement) {
    if (statement === undefined || statement === null)
        return false;
    const body = statement.type === "BlockStatement" ? statement.body : [statement];
    return body.some((child) => child.type === "ThrowStatement" &&
        child.argument.type === "NewExpression" &&
        child.argument.callee.type === "Identifier" &&
        child.argument.callee.name === "Error");
}
/** Whether the binary expression compares a `._tag` member against a string literal.
 *
 * @param {ESTree.Expression} expression - The expression to inspect.
 * @returns {boolean} True when the comparison is a tag equality check.
 */
function isTagComparison(expression) {
    if (expression.type !== "BinaryExpression")
        return false;
    if (expression.operator !== "!==" && expression.operator !== "===")
        return false;
    const sides = [expression.left, expression.right];
    const hasTagMember = sides.some((side) => side.type === "MemberExpression" && side.property.type === "Identifier" && side.property.name === "_tag");
    const hasStringLiteral = sides.some((side) => side.type === "Literal" && isString(side.value));
    return hasTagMember && hasStringLiteral;
}
/**
 * Hand-rolled `if (x._tag !== "...") throw new Error(...)` ladders re-implement
 * narrowing assertions per spec; a shared assertTag helper does it once, with
 * type-level narrowing.
 */
export const noTagLadderAssertionsRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "In specs, replace hand-rolled _tag comparison + throw ladders with the shared assertTag narrowing helper from test helpers.",
        },
        messages: {
            ladder: "This _tag ladder re-implements variant assertion by hand. Use the shared `assertTag(value, tag)` helper so the branch narrows types and fails with a uniform message.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            IfStatement(node) {
                if (!isTagComparison(node.test))
                    return;
                if (isBuiltinThrowBranch(node.consequent) || isBuiltinThrowBranch(node.alternate)) {
                    context.report({ node, messageId: "ladder" });
                }
            },
        };
    },
});
