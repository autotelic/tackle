import { defineRule } from "@oxlint/plugins";
import { isString } from "../../shared/structural.js";
const PROVISION_METHODS = new Set(["provide", "provideMerge"]);
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Multiple provision stages in one pipe entangle dependency tiers; combine independent layers or name each stage.
 *
 * Import tracking covers local names bound to the `Layer` export of
 * "effect"; re-exports are not tracked.
 */
export const noCascadingLayerProvideRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow multiple Layer.provide/provideMerge stages in one pipe; combine independent dependencies in one Layer.provide([...]) and extract intentional dependency stages as named layers.",
        },
        messages: {
            cascadingProvide: "Multiple `Layer.provide` stages run in this pipe, entangling dependency tiers. Combine independent dependencies into one `Layer.provide([a, b])`; when a layer depends on another layer, extract that configured layer into a named value before providing it.",
        },
    },
    createOnce(context) {
        const layerNames = new Set();
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ImportDeclaration(node) {
                if (node.source.value !== "effect")
                    return;
                for (const specifier of node.specifiers) {
                    if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier") {
                        if (specifier.local.name === "Layer")
                            layerNames.add("Layer");
                        continue;
                    }
                    if (specifier.type !== "ImportSpecifier")
                        continue;
                    const importedName = specifier.imported.type === "Identifier"
                        ? specifier.imported.name
                        : isString(specifier.imported.value)
                            ? specifier.imported.value
                            : undefined;
                    if (importedName !== "Layer")
                        continue;
                    layerNames.add(specifier.local.name);
                }
            },
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== "MemberExpression" ||
                    callee.computed ||
                    callee.property.type !== "Identifier" ||
                    callee.property.name !== "pipe") {
                    return;
                }
                let stages = 0;
                for (const argument of node.arguments) {
                    if (argument.type === "CallExpression" &&
                        argument.callee.type === "MemberExpression" &&
                        !argument.callee.computed &&
                        argument.callee.object.type === "Identifier" &&
                        layerNames.has(argument.callee.object.name) &&
                        argument.callee.property.type === "Identifier" &&
                        PROVISION_METHODS.has(argument.callee.property.name))
                        stages += 1;
                }
                if (stages < 2)
                    return;
                context.report({ node, messageId: "cascadingProvide" });
            },
        };
    },
});
