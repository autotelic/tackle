import { defineRule } from "@oxlint/plugins";
import { readField } from "../shared/structural.js";
import { ancestorsOf } from "../shared/ancestors.js";
function lastTypeNameSegment(typeName) {
    if (typeName.type === "Identifier")
        return typeName.name;
    if (typeName.type === "TSQualifiedName")
        return lastTypeNameSegment(typeName.right);
    return null;
}
/**
 * Returns the enclosing TSPropertySignature when the literal is a variant
 * payload of a Data.TaggedEnum (i.e. `{ Variant: Payload }` inside the enum's
 * type argument), otherwise null.
 *
 * @param {ESTree.TSTypeLiteral} node - The visited type literal (candidate payload).
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain of `node`.
 * @returns {ESTree.TSPropertySignature | null} The variant property signature, or null.
 */
function variantPayloadSignature(node, ancestors) {
    const at = (depth) => ancestors[ancestors.length - 1 - depth];
    const annotation = at(0);
    if (annotation?.type !== "TSTypeAnnotation")
        return null;
    const signature = at(1);
    if (signature?.type !== "TSPropertySignature")
        return null;
    const outer = at(2);
    if (outer?.type !== "TSTypeLiteral")
        return null;
    const args = at(3);
    if (args === undefined)
        return null;
    const reference = at(4);
    if (reference?.type !== "TSTypeReference")
        return null;
    const name = lastTypeNameSegment(reference.typeName);
    return name !== null && /TaggedEnum$/u.test(name) ? signature : null;
}
/** A product of booleans inside a variant tends to admit an illegal combination. */
export const noProductOfStateBooleansRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow tagged-enum variant payloads with two or more boolean state flags; replace them with a nested tag union so impossible combinations can't be represented.",
        },
        messages: {
            productOfStateBooleans: "Variant payload `{{name}}` carries {{count}} boolean state flags. Replace them with a nested tag union (e.g. Sign) so combinations like {zero, negative} can't be represented.",
        },
    },
    createOnce(context) {
        return {
            TSTypeLiteral(node) {
                const signature = variantPayloadSignature(node, ancestorsOf(context.sourceCode, node));
                if (signature === null)
                    return;
                let count = 0;
                for (const member of node.members) {
                    if (member.type !== "TSPropertySignature")
                        continue;
                    const annotation = member.typeAnnotation;
                    if (annotation === null || annotation === undefined)
                        continue;
                    if (annotation.typeAnnotation.type === "TSBooleanKeyword")
                        count += 1;
                }
                if (count < 2)
                    return;
                const key = signature.key;
                const name = key.type === "Identifier" ? key.name : "variant";
                context.report({
                    node,
                    messageId: "productOfStateBooleans",
                    data: { name, count: String(count) },
                });
            },
        };
    },
});
