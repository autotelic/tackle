import { defineRule } from "@oxlint/plugins";
import { isString, readField } from "../../shared/structural.js";
/**
 * Property-name reader for visitor properties. The `Property` selector receives
 * Object/Binding/AssignmentTarget properties; all share this structural shape.
 *
 * @param {{ readonly computed: boolean; readonly key: ESTree.Expression | ESTree.PrivateIdentifier }} node - A visited property node.
 * @returns {string | null} The non-computed property's identifier or literal string name.
 */
function propertyName(node) {
    if (node.computed)
        return null;
    const key = node.key;
    const name = readField(key, "name");
    if (readField(key, "type") === "Identifier" && isString(name))
        return name;
    const value = readField(key, "value");
    if (readField(key, "type") === "Literal" && isString(value))
        return value;
    return null;
}
/** File-scoping logic belongs in the `before` hook, not scattered through visitors or `create`. */
export const preferBeforeFileScopeRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Read `context.filename` only inside a `before` hook; skip the file by returning `false` there.",
        },
        messages: {
            moveToBefore: "File-scoping read of `context.filename` outside `before()`. Do file selection in `before()` and return `false` to skip the file, keeping visitors free of filename checks.",
        },
    },
    createOnce(context) {
        let insideBeforeHook = false;
        return {
            Property(node) {
                if (!insideBeforeHook && propertyName(node) === "before")
                    insideBeforeHook = true;
            },
            "Property:exit"(node) {
                if (insideBeforeHook && propertyName(node) === "before")
                    insideBeforeHook = false;
            },
            MemberExpression(node) {
                if (insideBeforeHook)
                    return;
                if (node.computed)
                    return;
                if (node.object.type !== "Identifier" || node.object.name !== "context")
                    return;
                if (node.property.type !== "Identifier" || node.property.name !== "filename")
                    return;
                context.report({ node, messageId: "moveToBefore" });
            },
        };
    },
});
