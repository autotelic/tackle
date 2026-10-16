import { defineRule } from "@oxlint/plugins";
import { firstOptionRecord } from "../shared/rule-options.js";
import { isRecordObject, isString } from "../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Generic built-in errors: untyped, prose-only, and invisible to tag-based handling. */
const BUILTIN_ERRORS = new Set([
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "AggregateError",
]);
/**
 * Unwrap parenthesized expressions to the underlying expression.
 *
 * @param {ESTree.Expression} expression - The expression to unwrap.
 * @returns {ESTree.Expression} The first non-parenthesized inner expression.
 */
function unwrapParentheses(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression")
        current = current.expression;
    return current;
}
/**
 * Flag throwing generic built-in errors at call sites that should instead throw
 * a project-defined tagged error carrying its evidence structurally (e.g.
 * Data.TaggedError with operation/value/domain fields plus a rendered message).
 */
export const noBuiltinThrowsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow throwing built-in Error constructors; require project-defined tagged error classes so defects carry structured evidence and can be matched by tag.",
        },
        messages: {
            noBuiltinThrows: "Throwing the built-in `{{builtin}}` loses structure: consumers get prose only. Throw a project-defined tagged error (e.g. Data.TaggedError) whose fields carry the operation, offending value, and domain, and render this context as its message.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    allow: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
            },
        ],
        defaultOptions: [{ allow: [] }],
    },
    createOnce(context) {
        const option = firstOptionRecord(context.options);
        const allowed = new Set(Array.isArray(option.allow) ? option.allow.filter(isString) : []);
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ThrowStatement(node) {
                const argument = node.argument === null || node.argument === undefined ? undefined : unwrapParentheses(node.argument);
                if (argument?.type !== "NewExpression")
                    return;
                if (argument.callee.type !== "Identifier")
                    return;
                const builtin = argument.callee.name;
                if (!BUILTIN_ERRORS.has(builtin) || allowed.has(builtin))
                    return;
                context.report({ node, messageId: "noBuiltinThrows", data: { builtin } });
            },
        };
    },
});
