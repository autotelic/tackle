import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
const LADDER_THRESHOLD = 3;
/** Whether this call is an Effect combinator chained in the flatMap/map ladder family.
 *
 * @param {ESTree.CallExpression} node - The candidate call expression.
 * @returns {boolean} True when the callee is an Effect flatMap/map-family combinator.
 */
function isEffectLadderCombinator(node) {
    const callee = node.callee;
    if (callee.type !== "MemberExpression" || callee.computed)
        return false;
    if (callee.object.type !== "Identifier" || callee.object.name !== "Effect")
        return false;
    const name = callee.property.type === "Identifier" ? callee.property.name : "";
    return name === "flatMap" || name === "andThen" || name === "tap";
}
/**
 * Long Effect.flatMap ladders read as callback pyramids; Effect.gen renders the
 * same program as straight-line validation.
 */
export const preferEffectGenForGuardLaddersRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Suggest Effect.gen when a function chains several Effect.flatMap/andThen/tap combinators instead of reading as straight-line code.",
        },
        messages: {
            ladder: "This function chains {{count}} Effect ladder combinators. Rewrite with `Effect.gen` + `yield*` so the guard sequence reads top-to-bottom.",
        },
    },
    createOnce(context) {
        const counts = new Map();
        const reported = new Set();
        const enclosingFunction = (node) => {
            const ancestors = ancestorsOf(context.sourceCode, node);
            for (let index = ancestors.length - 1; index >= 0; index--) {
                const current = ancestors[index];
                if (current.type === "Program")
                    break;
                if (current.type === "FunctionDeclaration" ||
                    current.type === "FunctionExpression" ||
                    current.type === "ArrowFunctionExpression") {
                    return current;
                }
            }
            return undefined;
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
                counts.clear();
                reported.clear();
            },
            CallExpression(node) {
                if (!isEffectLadderCombinator(node))
                    return;
                const owner = enclosingFunction(node);
                if (owner === undefined)
                    return;
                const next = (counts.get(owner) ?? 0) + 1;
                counts.set(owner, next);
                if (next >= LADDER_THRESHOLD && !reported.has(owner)) {
                    reported.add(owner);
                    context.report({ node: owner, messageId: "ladder", data: { count: String(next) } });
                }
            },
        };
    },
});
