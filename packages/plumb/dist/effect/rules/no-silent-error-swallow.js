import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
const CATCH_METHODS = new Set([
    "catch",
    "catchTag",
    "catchTags",
    "catchReason",
    "catchReasons",
]);
const VOID_OR_UNIT_METHODS = new Set(["void", "unit"]);
/**
 * Whether the expression is the bare `Effect.void` / `Effect.unit` member.
 *
 * @param {ESTree.Node | null | undefined} node - The candidate member expression.
 * @returns {boolean} True when the expression reads Effect.void or Effect.unit.
 */
function isEffectVoidOrUnit(node) {
    if (node === null || node === undefined || node.type !== "MemberExpression")
        return false;
    if (node.object.type !== "Identifier" || node.object.name !== "Effect")
        return false;
    return node.property.type === "Identifier" && VOID_OR_UNIT_METHODS.has(node.property.name);
}
/**
 * A recovery callback that reduces every failure to Effect.void/unit swallows it silently.
 *
 * @param {ESTree.Node} handler - The catch handler argument to inspect.
 * @returns {boolean} True when the handler can only produce Effect.void/unit.
 */
function returnsOnlyVoid(handler) {
    if (handler.type !== "ArrowFunctionExpression" &&
        handler.type !== "FunctionExpression") {
        return false;
    }
    const body = handler.body;
    if (body === null || body === undefined)
        return false;
    if (isEffectVoidOrUnit(body))
        return true;
    if (body.type !== "BlockStatement")
        return false;
    if (body.body.length !== 1)
        return false;
    const statement = body.body[0];
    if (statement.type !== "ReturnStatement")
        return false;
    return isEffectVoidOrUnit(statement.argument);
}
/** Recovering into Effect.void/Effect.unit erases the failure; recover meaningfully or propagate. */
export const noSilentErrorSwallowRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow Effect catch handlers that reduce failures to Effect.void or Effect.unit; recover meaningfully, transform the error, or let it propagate.",
        },
        messages: {
            silentSwallow: "This catch handler reduces every failure to `Effect.void`/`Effect.unit`, erasing the error. Recover meaningfully, transform it into a tagged failure, or remove the handler and let the error propagate.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== "MemberExpression" ||
                    callee.computed ||
                    callee.object.type !== "Identifier" ||
                    callee.object.name !== "Effect" ||
                    callee.property.type !== "Identifier" ||
                    !CATCH_METHODS.has(callee.property.name)) {
                    return;
                }
                for (const argument of node.arguments) {
                    if (returnsOnlyVoid(argument)) {
                        context.report({ node, messageId: "silentSwallow" });
                        return;
                    }
                    if (argument.type !== "ObjectExpression")
                        continue;
                    for (const property of argument.properties) {
                        if (property.type !== "Property")
                            continue;
                        if (returnsOnlyVoid(property.value)) {
                            context.report({ node, messageId: "silentSwallow" });
                            return;
                        }
                    }
                }
            },
        };
    },
});
