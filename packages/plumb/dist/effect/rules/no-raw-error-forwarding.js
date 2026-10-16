import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/test\//u;
/** Error properties that carry internal details and must not be forwarded raw. */
const ERROR_PROPS = new Set(["message", "stack"]);
/**
 * Whether a member expression accesses an error property on a catch parameter.
 * @param {ESTree.MemberExpression} member - The member expression to test.
 * @param {ReadonlySet<string>} catchParams - Names of catch parameters in scope.
 * @returns {boolean} True when the member accesses an error property on a catch param.
 */
function isErrorPropAccess(member, catchParams) {
    if (member.object.type !== "Identifier")
        return false;
    if (!catchParams.has(member.object.name))
        return false;
    if (member.computed)
        return false;
    return member.property.type === "Identifier" && ERROR_PROPS.has(member.property.name);
}
/**
 * Whether the error property access is inside a console.* call (logging, not forwarding).
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The node to test.
 * @returns {boolean} True when the access is inside a console.* call.
 */
function isLoggingCall(sourceCode, node) {
    const chain = ancestorsOf(sourceCode, node);
    for (let i = chain.length - 1; i >= 0; i--) {
        const ancestor = chain[i];
        if (ancestor === undefined)
            continue;
        if (ancestor.type === "CallExpression" && ancestor.callee.type === "MemberExpression") {
            const obj = ancestor.callee.object;
            if (obj.type === "Identifier" && obj.name === "console")
                return true;
        }
        if (ancestor.type === "Program" || ancestor.type === "BlockStatement")
            return false;
    }
    return false;
}
/**
 * Disallow forwarding raw error messages from caught exceptions. This pattern
 * re-invent's Effect's typed error channel: raw strings leak internal details
 * (stack traces, file paths, database errors) and lose structure so callers
 * can't match on the failure kind.
 *
 * Use Effect's `TaggedError`: a tagged class per failure kind carrying
 * structured evidence as fields, rendering its message from those fields. The
 * error then flows through Effect's typed error channel instead of being
 * stringified at every boundary.
 */
export const noRawErrorForwardingRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow forwarding raw error messages (e.message, e.stack) from caught exceptions; this pattern re-invent's Effect's typed error channel. Use Effect's TaggedError so failures carry structured evidence and flow through the typed channel.",
        },
        messages: {
            rawErrorForwarding: "Forwarding the raw error '{{prop}}' re-invent's Effect's typed error channel: it leaks internal details and loses structure so callers can't match on the failure kind. Use Effect's TaggedError (a tagged class per failure kind carrying structured evidence as fields) so the error flows through the typed channel.",
        },
    },
    createOnce(context) {
        const catchParamStack = [];
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            CatchClause(node) {
                const param = node.param;
                if (param !== null && param !== undefined && param.type === "Identifier") {
                    catchParamStack.push(new Set([param.name]));
                }
                else {
                    catchParamStack.push(new Set());
                }
            },
            "CatchClause:exit"() {
                catchParamStack.pop();
            },
            MemberExpression(node) {
                if (catchParamStack.length === 0)
                    return;
                const allParams = new Set();
                for (const params of catchParamStack) {
                    for (const name of params)
                        allParams.add(name);
                }
                if (!isErrorPropAccess(node, allParams))
                    return;
                if (isLoggingCall(context.sourceCode, node))
                    return;
                context.report({
                    node,
                    messageId: "rawErrorForwarding",
                    data: { prop: node.property.type === "Identifier" ? node.property.name : "message" },
                });
            },
        };
    },
});
