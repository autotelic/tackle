import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/**
 * Whether a call targets `Layer.provide`.
 *
 * @param {ESTree.Node} node - The candidate call expression.
 * @returns {boolean} True when the call is a Layer.provide invocation.
 */
function isLayerProvide(node) {
    if (node.type !== "CallExpression")
        return false;
    const callee = node.callee;
    if (callee.type !== "MemberExpression" || callee.computed)
        return false;
    if (callee.object.type !== "Identifier")
        return false;
    return callee.object.name === "Layer" && callee.property.type === "Identifier" && callee.property.name === "provide";
}
/** Nested Layer.provide calls hide the dependency stage; extract the inner layer or use provideMerge. */
export const noNestedLayerProvideRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow Layer.provide nested inside Layer.provide; extract the inner layer to a named value or use Layer.provideMerge so each dependency stage is visible.",
        },
        messages: {
            nestedProvide: "`Layer.provide` inside `Layer.provide` hides this dependency stage. Extract the inner layer into a named value, or use `Layer.provideMerge` when the layers are independent.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            CallExpression(node) {
                if (!isLayerProvide(node))
                    return;
                for (const argument of node.arguments) {
                    if (isLayerProvide(argument)) {
                        context.report({
                            node: argument,
                            messageId: "nestedProvide",
                        });
                    }
                }
            },
        };
    },
});
