import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
import { readField } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
const commentOwnerKinds = new Set([
    "ExpressionStatement",
    "ReturnStatement",
    "ThrowStatement",
    "VariableDeclaration",
]);
/** Whether the nearest annotated function returns through the Effect/Either/Option channel.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The JSON.parse call expression.
 * @returns {boolean} True when an enclosing function declares a channel return type.
 */
function insideChannelReturningFunction(sourceCode, node) {
    const chain = ancestorsOf(sourceCode, node);
    for (let index = chain.length - 1; index >= 0; index--) {
        const current = chain[index];
        if (current.type === "Program")
            break;
        if (current.type !== "FunctionDeclaration" &&
            current.type !== "FunctionExpression" &&
            current.type !== "ArrowFunctionExpression") {
            continue;
        }
        const returnType = current.returnType?.typeAnnotation;
        if (returnType == null)
            continue;
        const text = annotationText(returnType);
        if (/\b(?:Effect|Either|Option)(?:\.|\b)/u.test(text))
            return true;
    }
    return false;
}
/** Render an annotation to text so qualified names like Effect.Effect match.
 *
 * @param {ESTree.TSType} type - The type node to render.
 * @returns {string} A space-joined textual sketch of the annotation.
 */
function annotationText(type) {
    switch (type.type) {
        case "TSTypeReference": {
            const name = type.typeName;
            const head = name.type === "Identifier"
                ? name.name
                : name.type === "TSQualifiedName"
                    ? name.right.name
                    : "";
            const args = readField(type, "typeArguments");
            const renderedArgs = args?.params?.map(annotationText).join(" ") ?? "";
            return `${head} ${renderedArgs}`;
        }
        case "TSUnionType":
        case "TSIntersectionType":
            return type.types.map(annotationText).join(" ");
        case "TSTupleType": {
            const render = (element) => {
                if ("elementType" in element)
                    return render(element.elementType);
                if (element.type === "TSOptionalType" || element.type === "TSRestType") {
                    return annotationText(element.typeAnnotation);
                }
                return annotationText(element);
            };
            return type.elementTypes.map(render).join(" ");
        }
        case "TSTypeOperator":
            return annotationText(type.typeAnnotation);
        case "TSArrayType":
            return annotationText(type.elementType);
        default:
            return "";
    }
}
/**
 * Whether a call targets Effect.try or Effect.trySync.
 *
 * @param {ESTree.Node} node - The candidate call expression.
 * @returns {boolean} True when the call is an Effect.try family invocation.
 */
function isEffectTryCall(node) {
    if (node.type !== "CallExpression")
        return false;
    const callee = node.callee;
    return (callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "Effect" &&
        callee.property.type === "Identifier" &&
        (callee.property.name === "try" || callee.property.name === "trySync"));
}
/**
 * Guard recognition for a JSON.parse site.
 *
 * A thunk handed straight to Effect.try through an object literal
 * ({ try: () => ..., catch: ... }) counts as guarded: climb past pure
 * containers (Property, ObjectExpression, ArrayExpression) and resume the
 * walk at the container exit, re-processing it.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The JSON.parse call expression.
 * @returns {boolean} True when the parse site is guarded.
 */
function isGuardedParse(sourceCode, node) {
    const chain = [...ancestorsOf(sourceCode, node)].reverse();
    let index = 0;
    while (index < chain.length) {
        const current = chain[index];
        if (current.type === "Program")
            return false;
        if (current.type === "TryStatement")
            return true;
        if (isEffectTryCall(current))
            return true;
        if (current.type === "FunctionDeclaration" ||
            current.type === "FunctionExpression" ||
            current.type === "ArrowFunctionExpression") {
            let probeIndex = index + 1;
            while (probeIndex < chain.length &&
                (chain[probeIndex].type === "Property" ||
                    chain[probeIndex].type === "ObjectExpression" ||
                    chain[probeIndex].type === "ArrayExpression")) {
                probeIndex += 1;
            }
            if (probeIndex < chain.length && isEffectTryCall(chain[probeIndex])) {
                index = probeIndex;
                continue;
            }
            return false;
        }
        index += 1;
    }
    return false;
}
/**
 * Whether a SAFETY comment covers this parse site or one of its statement owners.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The JSON.parse call expression.
 * @returns {boolean} True when an applicable SAFETY justification exists.
 */
function hasSafetyComment(sourceCode, node) {
    const chain = [node, ...[...ancestorsOf(sourceCode, node)].reverse()];
    for (let index = 0; index < chain.length; index += 1) {
        const current = chain[index];
        if (sourceCode
            .getCommentsBefore(current)
            .some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value))) {
            return true;
        }
        if (commentOwnerKinds.has(current.type))
            return false;
        const parent = chain[index + 1];
        if (parent === undefined || parent.type === "Program")
            return false;
    }
    return false;
}
/**
 * JSON.parse throws a raw SyntaxError defect. Inside an Effect/Either/Option
 * channel that bypasses the typed failure path unless explicitly guarded.
 */
export const noUnguardedJsonParseRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require JSON.parse inside Effect/Either/Option-returning functions to be channelled through Effect.try (or a try/catch), or justified with a SAFETY comment for provably-total parses.",
        },
        messages: {
            unguardedParse: "`JSON.parse` here throws a raw SyntaxError defect past the typed error channel. Channel it with `Effect.try({ try: ..., catch: ... })` failing a tagged reason (e.g. MalformedRenderError), or justify totality with a `SAFETY:` comment.",
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
                    callee.object.name !== "JSON" ||
                    callee.property.type !== "Identifier" ||
                    callee.property.name !== "parse")
                    return;
                if (!insideChannelReturningFunction(context.sourceCode, node))
                    return;
                if (isGuardedParse(context.sourceCode, node))
                    return;
                if (hasSafetyComment(context.sourceCode, node))
                    return;
                context.report({ node, messageId: "unguardedParse" });
            },
        };
    },
});
