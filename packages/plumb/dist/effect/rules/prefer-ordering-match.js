import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
const ORDERING_OPERATORS = new Set(["<", ">", "<=", ">=", "===", "=="]);
function isZeroLiteral(expression) {
    return (expression !== null &&
        expression !== undefined &&
        expression.type === "Literal" &&
        expression.value === 0);
}
/** Source text of the operand compared against zero, or null when this is not one.
 *
 * @param {{ test: ESTree.Expression; sourceText: string }} payload - The compared test and its source text.
 * @returns {string | null} Source text of the non-zero side, or null.
 */
function orderingZeroSubject(payload) {
    const { test, sourceText } = payload;
    let binary = test;
    while (binary.type === "ParenthesizedExpression") {
        binary = binary.expression;
    }
    if (binary.type !== "BinaryExpression" || !ORDERING_OPERATORS.has(binary.operator)) {
        return null;
    }
    const slice = (expression) => sourceText.slice(expression.range?.[0] ?? 0, expression.range?.[1] ?? 0).trim();
    if (isZeroLiteral(binary.right))
        return slice(binary.left);
    if (isZeroLiteral(binary.left))
        return slice(binary.right);
    return null;
}
function isSentinelValue(expression) {
    if (expression === null || expression === undefined)
        return false;
    if (expression.type === "ParenthesizedExpression") {
        return isSentinelValue(expression.expression);
    }
    if (expression.type === "UnaryExpression") {
        return (expression.operator === "-" &&
            expression.argument.type === "Literal" &&
            expression.argument.value === 1);
    }
    return expression.type === "Literal" && (expression.value === 0 || expression.value === 1);
}
function lastReturnedValue(block) {
    const statement = block.body[block.body.length - 1];
    return statement !== undefined && statement.type === "ReturnStatement"
        ? statement.argument
        : undefined;
}
/** Hand-mapping an ordering comparison to domain values duplicates Ordering.match. */
export const preferOrderingMatchRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require ladders of conditional branches re-testing the same ordering comparison against zero to be expressed as one Ordering.match table.",
        },
        messages: {
            preferOrderingMatch: "This ladder re-tests `{{subject}}` against zero {{links}} times to pick domain values. Replace it with a single Ordering.match({ onLessThan, onEqual, onGreaterThan }) over the comparison result so the direction mapping lives in one exhaustive table.",
        },
    },
    createOnce(context) {
        const checkChain = (tests, leaves) => {
            if (tests.length < 2)
                return;
            if (tests.some((test) => test.subject === null))
                return;
            const subject = tests[0].subject;
            if (tests.some((test) => test.subject !== subject))
                return;
            if (leaves.every((leaf) => isSentinelValue(leaf)))
                return;
            context.report({
                node: tests[0].node,
                messageId: "preferOrderingMatch",
                data: { subject, links: String(tests.length) },
            });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ConditionalExpression(node) {
                const tests = [];
                const leaves = [];
                let current = node;
                while (current !== null && current.type === "ConditionalExpression") {
                    tests.push({
                        subject: orderingZeroSubject({ test: current.test, sourceText: context.sourceCode.text }),
                        node: current.test,
                    });
                    leaves.push(current.consequent);
                    const alternate = current.alternate;
                    if (alternate.type === "ConditionalExpression") {
                        current = alternate;
                    }
                    else {
                        leaves.push(alternate);
                        current = null;
                    }
                }
                checkChain(tests, leaves);
            },
            IfStatement(node) {
                const tests = [];
                const leaves = [];
                let current = node;
                while (current !== null && current.type === "IfStatement") {
                    tests.push({
                        subject: orderingZeroSubject({ test: current.test, sourceText: context.sourceCode.text }),
                        node: current.test,
                    });
                    const consequent = current.consequent;
                    leaves.push(consequent.type === "BlockStatement"
                        ? lastReturnedValue(consequent)
                        : consequent);
                    const alternate = current.alternate;
                    if (alternate === null) {
                        current = null;
                    }
                    else if (alternate.type === "IfStatement") {
                        current = alternate;
                    }
                    else {
                        leaves.push(alternate.type === "BlockStatement"
                            ? lastReturnedValue(alternate)
                            : alternate);
                        current = null;
                    }
                }
                checkChain(tests, leaves);
            },
        };
    },
});
