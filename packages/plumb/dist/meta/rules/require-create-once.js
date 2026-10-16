import { defineRule } from "@oxlint/plugins";
import { isString } from "../../shared/structural.js";
/**
 * Static property name of an object property node.
 *
 * @param {ESTree.ObjectProperty} key - The property node to inspect.
 * @returns {string | null} The identifier or literal string name, or null when computed.
 */
function propertyName(key) {
    if (key.computed)
        return null;
    if (key.key.type === "Identifier")
        return key.key.name;
    if (key.key.type === "Literal" && isString(key.key.value))
        return key.key.value;
    return null;
}
/** Rule objects should opt into Oxlint's performant createOnce API, not ESLint's per-file create. */
export const requireCreateOnceRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Require `createOnce` instead of `create` when authoring Oxlint rules.",
        },
        messages: {
            useCreateOnce: "`create` re-runs per file and blocks Oxlint's Rust-side traversal optimizations. Use `createOnce` (per-file setup belongs in the `before` hook).",
        },
    },
    createOnce(context) {
        const visitObject = (node) => {
            const keys = new Set();
            let createProperty = null;
            for (const property of node.properties) {
                if (property.type !== "Property")
                    continue;
                const name = propertyName(property);
                if (name === null)
                    continue;
                keys.add(name);
                if (name === "create")
                    createProperty = property;
            }
            if (createProperty !== null && keys.has("meta")) {
                context.report({ node: createProperty, messageId: "useCreateOnce" });
            }
        };
        return {
            ObjectExpression: visitObject,
        };
    },
});
