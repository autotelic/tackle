import { defineRule } from "@oxlint/plugins";
import { isString } from "../shared/structural.js";
import { inValuesPath } from "../shared/values-path.js";
/** The suffixes that name an instant rather than a piece of text. */
const INSTANT_SUFFIXES = ["At", "Date", "Timestamp", "_at", "_date"];
/** Whether a field name claims to be an instant.
 *
 * @param {string} name - The field's name.
 * @returns {boolean} True when the name is a date or a time.
 */
export function namesAnInstant(name) {
    if (name.toLowerCase() === "timestamp")
        return true;
    return INSTANT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
/** Whether a schema chain bottoms out at `Schema.String`.
 *
 * @param {ESTree.Node} node - The field's value expression.
 * @returns {boolean} True when the chain constructs a string.
 */
function isSchemaString(node) {
    if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
        return node.property.name === "String";
    }
    if (node.type === "CallExpression") {
        const first = node.arguments[0];
        return first !== undefined && isSchemaString(first);
    }
    return node.type === "TSNonNullExpression" ? isSchemaString(node.expression) : false;
}
/** The key of an object property, when it is a plain name.
 *
 * @param {ESTree.ObjectProperty} property - The property to read.
 * @returns {string | null} The key, or null for a computed or spread entry.
 */
function propertyKey(property) {
    if (property.key.type === "Identifier")
        return property.key.name;
    if (property.key.type === "Literal" && isString(property.key.value))
        return property.key.value;
    return null;
}
/**
 * An instant is a value with an identity, not the text of one.
 *
 * `"2026-10-22T00:00:00Z"` and `"2026-10-22 00:00:00+00"` agree until one of
 * them crosses a timezone. A string field in the values stratum lets every
 * reader parse it differently, so the format becomes folklore instead of a
 * type. The wire type may be text; the value must not.
 */
export const noStringInstantRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Disallow string-typed instant fields inside a declared values path; use a date type so the format has one implementation.",
        },
        messages: {
            stringInstant: "`{{name}}` holds an instant as text. Text is transport: two formats that agree today disagree after a timezone. Parse it at the boundary and carry a date type here.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    paths: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
            },
        ],
        defaultOptions: [{}],
    },
    createOnce(context) {
        function checkProperty(node) {
            if (node.key.type !== "Identifier" || !namesAnInstant(node.key.name))
                return;
            if (node.typeAnnotation?.typeAnnotation.type !== "TSStringKeyword")
                return;
            context.report({ node, messageId: "stringInstant", data: { name: node.key.name } });
        }
        function checkStruct(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier")
                return;
            if (callee.property.name !== "Struct")
                return;
            const first = node.arguments[0];
            if (first === undefined || first.type !== "ObjectExpression")
                return;
            for (const property of first.properties) {
                if (property.type !== "Property")
                    continue;
                const name = propertyKey(property);
                if (name === null || !namesAnInstant(name))
                    continue;
                if (!isSchemaString(property.value))
                    continue;
                context.report({ node: property, messageId: "stringInstant", data: { name } });
            }
        }
        return {
            before() {
                if (!inValuesPath(context.filename, context.options))
                    return false;
            },
            TSPropertySignature: checkProperty,
            CallExpression: checkStruct,
        };
    },
});
