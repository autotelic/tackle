import { defineRule } from "@oxlint/plugins";
import { ABSENCE_TYPE, OPTION_HIDES_REASON, TAGGED_REASON } from "../absence-shape.js";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
function isNullableKeyword(type) {
    return type.type === "TSNullKeyword" || type.type === "TSUndefinedKeyword";
}
/**
 * Returns whether a union pairs a nullable member with at least one real
 * value type (T | null/undefined, not void | undefined).
 *
 * @param {ESTree.TSUnionType} union - The union annotation to inspect.
 * @returns {boolean} True when the union mixes null/undefined with value types.
 */
function nullableWithValue(union) {
    let nullable = false;
    let value = false;
    for (const member of union.types) {
        if (isNullableKeyword(member)) {
            nullable = true;
        }
        else if (member.type !== "TSVoidKeyword" && member.type !== "TSNeverKeyword") {
            value = true;
        }
    }
    return nullable && value;
}
function asUnion(type) {
    if (type.type === "TSParenthesizedType")
        return asUnion(type.typeAnnotation);
    return type.type === "TSUnionType" ? type : null;
}
/**
 * Guarded operations must surface absence as ABSENCE_TYPE, not a null/undefined
 * union or a crash. The id keeps its historical "option" name so consumer configs
 * do not break.
 */
export const guardedOpMustReturnOptionRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: `Disallow returning T | null/undefined from guarded operations and getOrThrow escapes; express absence as ${ABSENCE_TYPE} so the reason survives. ${OPTION_HIDES_REASON}, so guarded-op-must-return-effect rejects it.`,
        },
        messages: {
            nullableReturn: `This function returns \`{{type}}\`, conflating absence with a value. Return \`${ABSENCE_TYPE}\` with ${TAGGED_REASON} for why the value is absent; absence here is a failure that has a why, and ${OPTION_HIDES_REASON}.`,
            optionEscape: `\`getOrThrow\` turns absence into a runtime crash. Match the \`${ABSENCE_TYPE}\` and handle the Left, or parse to a refined value so the empty branch can't exist.`,
        },
    },
    createOnce(context) {
        const checkReturnType = (node) => {
            const annotation = node.returnType;
            if (annotation === null || annotation === undefined)
                return;
            const type = annotation.typeAnnotation;
            const union = asUnion(type);
            if (union === null || !nullableWithValue(union))
                return;
            context.report({
                node: type,
                messageId: "nullableReturn",
                data: { type: context.sourceCode.getText(type) },
            });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ArrowFunctionExpression: checkReturnType,
            FunctionDeclaration: checkReturnType,
            FunctionExpression: checkReturnType,
            MemberExpression(node) {
                if (!node.computed &&
                    node.property.type === "Identifier" &&
                    node.property.name === "getOrThrow") {
                    context.report({ node, messageId: "optionEscape" });
                }
            },
            Identifier(node) {
                if (node.name !== "getOrThrow")
                    return;
                const parent = (ancestorsOf(context.sourceCode, node)).at(-1);
                if (parent?.type === "MemberExpression" && parent.property === node)
                    return;
                context.report({ node, messageId: "optionEscape" });
            },
        };
    },
});
