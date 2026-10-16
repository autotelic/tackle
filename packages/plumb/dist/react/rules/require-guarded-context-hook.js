import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
import { isHookName } from "../role.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * Whether a custom context hook that reads context must be reported for
 * lacking a guard against a missing Provider.
 *
 * @param {{ isHook: boolean; callsUseContext: boolean; guarded: boolean }} input - The hook's shape facts.
 * @returns {boolean} True when the hook needs a guard but has none.
 */
export function requiresContextGuard(input) {
    return input.isHook && input.callsUseContext && !input.guarded;
}
/**
 * The variable name an `if` test guards against a nullish value.
 *
 * @param {ESTree.Node} test - The if-statement test expression.
 * @returns {string | null} The guarded variable name, or null when not a nullish guard.
 */
function checkedVar(test) {
    if (test.type === "UnaryExpression" && test.operator === "!" && test.argument.type === "Identifier") {
        return test.argument.name;
    }
    if (test.type === "BinaryExpression") {
        const nullish = (operand) => (operand.type === "Identifier" && (operand.name === "undefined" || operand.name === "null")) ||
            (operand.type === "Literal" && (operand.value === null || operand.value === undefined));
        if (test.operator === "===" || test.operator === "!==" || test.operator === "==" || test.operator === "!=") {
            if (test.left.type === "Identifier" && nullish(test.right))
                return test.left.name;
            if (test.right.type === "Identifier" && nullish(test.left))
                return test.right.name;
        }
    }
    return null;
}
/**
 * Whether a statement (or its block body) throws.
 *
 * @param {ESTree.Node} node - The statement node to inspect.
 * @returns {boolean} True when the statement throws.
 */
function containsThrow(node) {
    if (node.type === "ThrowStatement")
        return true;
    if (node.type === "BlockStatement")
        return node.body.some((s) => s.type === "ThrowStatement");
    return false;
}
/**
 * Whether the callee references `useContext`.
 *
 * @param {ESTree.Node} callee - The callee expression of a call.
 * @returns {boolean} True when the callee is `useContext`.
 */
function isUseContext(callee) {
    if (callee.type === "Identifier")
        return callee.name === "useContext";
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier")
        return callee.property.name === "useContext";
    return false;
}
/**
 * A custom hook that reads context with `useContext` must throw when the
 * Provider is missing, rather than returning `undefined` and pushing a
 * null-check onto every consumer. Returning a possibly-undefined context is the
 * same hidden-nullable defect the rest of the library forbids.
 */
export const requireGuardedContextHookRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require custom context hooks (useXxx calling useContext) to throw when the Provider is missing, instead of returning a possibly-undefined context.",
        },
        messages: {
            unguardedContext: "`{{name}}` reads context with useContext but never guards against a missing Provider (no `if (!context) throw`). A context read outside the Provider returns undefined; throw when it is absent so consumers get a clear error instead of a nullable value.",
        },
    },
    createOnce(context) {
        const frames = [];
        const push = (entry) => {
            frames.push({ name: entry.name, node: entry.node, useContextVars: new Set(), guardedVars: new Set() });
        };
        const current = () => frames[frames.length - 1];
        /**
         * Nearest enclosing function name for a node (declaration or variable binding).
         *
         * @param {ESTree.Node} node - The reference node.
         * @returns {string | null} The nearest function name, or null when anonymous.
         */
        function nearestFunctionName(node) {
            const ancestors = ancestorsOf(context.sourceCode, node);
            for (let i = ancestors.length - 1; i >= 0; i--) {
                const a = ancestors[i];
                if (a === undefined)
                    continue;
                if (a.type === "FunctionDeclaration" && a.id !== null && a.id !== undefined)
                    return a.id.name;
                if (a.type === "FunctionExpression" && a.id !== null && a.id !== undefined)
                    return a.id.name;
                if (a.type === "VariableDeclarator" && a.id.type === "Identifier") {
                    const init = a.init;
                    if (init !== null &&
                        init !== undefined &&
                        (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression"))
                        return a.id.name;
                }
            }
            return null;
        }
        return {
            before() {
                frames.length = 0;
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            FunctionDeclaration(node) {
                push({ name: node.id?.name ?? null, node });
            },
            "FunctionDeclaration:exit"() {
                const frame = frames.pop();
                if (frame !== undefined)
                    report(frame);
            },
            FunctionExpression(node) {
                push({ name: node.id?.name ?? null, node });
            },
            "FunctionExpression:exit"() {
                const frame = frames.pop();
                if (frame !== undefined)
                    report(frame);
            },
            ArrowFunctionExpression(node) {
                push({ name: nearestFunctionName(node), node });
            },
            "ArrowFunctionExpression:exit"() {
                const frame = frames.pop();
                if (frame !== undefined)
                    report(frame);
            },
            CallExpression(node) {
                if (!isUseContext(node.callee))
                    return;
                const parent = ancestorsOf(context.sourceCode, node).at(-1);
                if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
                    current()?.useContextVars.add(parent.id.name);
                }
            },
            IfStatement(node) {
                const variable = checkedVar(node.test);
                if (variable === null)
                    return;
                if (containsThrow(node.consequent) || (node.alternate !== null && containsThrow(node.alternate))) {
                    current()?.guardedVars.add(variable);
                }
            },
        };
        function report(frame) {
            if (!isHookName(frame.name))
                return;
            const unguarded = [...frame.useContextVars].filter((v) => !frame.guardedVars.has(v));
            if (unguarded.length === 0)
                return;
            context.report({ node: frame.node, messageId: "unguardedContext", data: { name: frame.name } });
        }
    },
});
