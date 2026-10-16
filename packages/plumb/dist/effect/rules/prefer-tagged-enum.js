import { defineRule } from "@oxlint/plugins";
import { isRecordObject, isString } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Whether a type-literal member declares a literal-typed `_tag` property.
 *
 * @param {ESTree.Node} member - A member of a type literal.
 * @returns {boolean} True when the member is `_tag` with a string literal type.
 */
function hasLiteralTagProperty(member) {
    if (member.type !== "TSPropertySignature")
        return false;
    const key = member.key;
    const isTagKey = (key.type === "Identifier" && key.name === "_tag") ||
        (key.type === "Literal" && key.value === "_tag");
    if (!isTagKey)
        return false;
    const annotation = member.typeAnnotation?.typeAnnotation;
    if (annotation === undefined || annotation === null || annotation.type !== "TSLiteralType") {
        return false;
    }
    return annotation.literal.type === "Literal" && isString(annotation.literal.value);
}
/** Whether every union constituent is a type literal carrying a `_tag` property.
 *
 * @param {ESTree.TSType} member - One constituent of a union annotation.
 * @returns {boolean} True when the member is a type literal with a `_tag`.
 */
function isTaggedLiteralMember(member) {
    if (member.type !== "TSTypeLiteral")
        return false;
    return member.members.some(hasLiteralTagProperty);
}
/** Hand-rolled _tag unions duplicate what Data.TaggedEnum gives for free. */
export const preferTaggedEnumRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require internal tagged unions to be declared with Data.TaggedEnum (constructors, $is guards and exhaustive $match) instead of hand-rolled _tag object-literal unions with manual type guards.",
        },
        messages: {
            preferTaggedEnum: "This union hand-rolls `_tag` discrimination. Declare it as `type {{name}} = Data.TaggedEnum<{...}>` and derive constructors, `$is` guards and exhaustive `$match` via `Data.taggedEnum<{{name}}>()`, matching the rational.ts idiom.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            TSTypeAliasDeclaration(node) {
                const annotation = node.typeAnnotation;
                if (annotation.type !== "TSUnionType")
                    return;
                if (annotation.types.length < 2)
                    return;
                if (!annotation.types.every((member) => isTaggedLiteralMember(member)))
                    return;
                context.report({
                    node: node.id,
                    messageId: "preferTaggedEnum",
                    data: { name: node.id.name },
                });
            },
        };
    },
});
