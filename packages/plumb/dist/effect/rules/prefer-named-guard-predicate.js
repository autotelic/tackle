import { defineRule } from "@oxlint/plugins";
import { childNodes } from "../../shared/child-nodes.js";
import { readField } from "../../shared/structural.js";
const PREDICATE_NAME = /^is[A-Z]/u;
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** True for a logical chain (>= 2 operands) whose every leaf is a domain-predicate call.
 *
 * @param {ESTree.Expression} expression - The guard test expression.
 * @returns {boolean} True when the chain is composed of domain predicates only.
 */
function isPredicateChain(expression) {
    if (expression.type !== "LogicalExpression")
        return false;
    return chainLeaf(expression.left) && chainLeaf(expression.right);
}
/**
 * Whether a leaf expression is a domain predicate call, not an Option combinator.
 *
 * @param {ESTree.Expression} expression - The leaf expression to test.
 * @returns {boolean} True when the callee matches the domain predicate naming scheme.
 */
function chainLeaf(expression) {
    if (expression.type === "LogicalExpression") {
        return chainLeaf(expression.left) && chainLeaf(expression.right);
    }
    if (expression.type === "ParenthesizedExpression") {
        return chainLeaf(expression.expression);
    }
    if (expression.type !== "CallExpression")
        return false;
    const callee = expression.callee;
    if (callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "Option") {
        return false;
    }
    if (callee.type === "Identifier")
        return PREDICATE_NAME.test(callee.name);
    return (callee.type === "MemberExpression" &&
        callee.property.type === "Identifier" &&
        PREDICATE_NAME.test(callee.property.name));
}
/** True when the subtree produces an Option.none()/Option.some(...) result.
 *
 * @param {ESTree.Node | null | undefined} node - The subtree root to scan.
 * @returns {boolean} True when an Option constructor call appears in the subtree.
 */
function containsOptionResult(node) {
    if (node === null || node === undefined)
        return false;
    if (node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Option" &&
        node.callee.property.type === "Identifier" &&
        (node.callee.property.name === "none" || node.callee.property.name === "some")) {
        return true;
    }
    return childNodes(node).some(containsOptionResult);
}
/** Inline chains of domain predicates guarding Options should be named Predicates. */
export const preferNamedGuardPredicateRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require guards built from chained domain predicates to be extracted into a named P.Predicate and lifted through Option.liftPredicate so the guard composes and carries a name.",
        },
        messages: {
            namedGuardPredicate: "This guard anonymously chains domain predicates. Extract a named `P.Predicate` (composed via P.and/P.or/P.not) and lift the value with `Option.liftPredicate` so the guard is reusable, testable and self-describing.",
        },
    },
    createOnce(context) {
        const checkGuard = (test, branches) => {
            if (!isPredicateChain(test))
                return;
            if (!branches.some((branch) => containsOptionResult(branch)))
                return;
            context.report({ node: test, messageId: "namedGuardPredicate" });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ConditionalExpression(node) {
                checkGuard(node.test, [node.consequent, node.alternate]);
            },
            IfStatement(node) {
                checkGuard(node.test, [node.consequent, node.alternate]);
            },
        };
    },
});
