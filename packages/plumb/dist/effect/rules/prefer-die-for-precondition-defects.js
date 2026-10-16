import { defineRule } from "@oxlint/plugins";
import { readField } from "../../shared/structural.js";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Unwrap a tuple element to the type node it contributes to the annotation walk.
 *
 * @param {ESTree.TSTupleElement} element - Tuple element node.
 * @returns {ESTree.TSType} The underlying type node.
 */
function tupleElementType(element) {
    if (element.type === "TSOptionalType" || element.type === "TSRestType") {
        return element.typeAnnotation;
    }
    if ("elementType" in element)
        return tupleElementType(element.elementType);
    return element;
}
/** Whether the annotation references the Effect or Either channel (defect-capable).
 *
 * @param {ESTree.Node} node - A function-like node whose return annotation is inspected.
 * @returns {boolean} True when the return annotation mentions Effect or Either.
 */
function returnsEffectOrFailChannel(node) {
    if (node.type !== "FunctionDeclaration" &&
        node.type !== "FunctionExpression" &&
        node.type !== "ArrowFunctionExpression") {
        return false;
    }
    const annotation = node.returnType?.typeAnnotation;
    if (annotation === undefined)
        return false;
    const seen = [annotation];
    while (seen.length > 0) {
        const type = seen.pop();
        if (type === undefined)
            continue;
        switch (type.type) {
            case "TSTypeReference": {
                const name = type.typeName;
                const head = name.type === "Identifier"
                    ? name.name
                    : name.type === "TSQualifiedName"
                        ? name.left.type === "Identifier"
                            ? name.left.name
                            : null
                        : null;
                if (head === "Effect" || head === "Either") {
                    return true;
                }
                const args = readField(type, "typeArguments");
                if (args?.params !== undefined)
                    seen.push(...args.params);
                break;
            }
            case "TSUnionType":
            case "TSIntersectionType":
                seen.push(...type.types);
                break;
            case "TSTupleType":
                for (const element of type.elementTypes) {
                    seen.push(tupleElementType(element));
                }
                break;
            case "TSTypeOperator":
                seen.push(type.typeAnnotation);
                break;
            case "TSArrayType":
                seen.push(type.elementType);
                break;
            default:
                break;
        }
    }
    return false;
}
/**
 * Precondition violations are defects by doctrine: thrown directly they escape
 * the Cause, invisible to telemetry and supervisors.
 */
export const preferDieForPreconditionDefectsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "In Effect/Either-returning functions, raise precondition defects with Effect.die instead of a bare throw so they travel inside the Cause.",
        },
        messages: {
            bareThrow: "This bare throw escapes the Effect `Cause`. Raise the tagged defect with `Effect.die(new ...)` (or reclassify the case as a typed failure on the error channel) so supervisors and telemetry observe it.",
        },
    },
    createOnce(context) {
        const check = (node) => {
            const ancestors = ancestorsOf(context.sourceCode, node);
            for (let index = ancestors.length - 1; index >= 0; index--) {
                const current = ancestors[index];
                if (current.type === "Program")
                    break;
                if (current.type === "FunctionDeclaration" ||
                    current.type === "FunctionExpression" ||
                    current.type === "ArrowFunctionExpression") {
                    if (returnsEffectOrFailChannel(current))
                        context.report({ node, messageId: "bareThrow" });
                    return;
                }
            }
        };
        return { before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ThrowStatement: check };
    },
});
