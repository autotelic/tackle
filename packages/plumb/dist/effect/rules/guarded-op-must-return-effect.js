import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Whether the member chain ends in the Option namespace, e.g. `Option` or `O`.
 *
 * @param {ESTree.Expression | ESTree.Super} node - The callee object to inspect.
 * @returns {boolean} True when the object resolves to the Option namespace.
 */
function isOptionObject(node) {
    if (node.type === "Identifier")
        return node.name === "Option";
    if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
        return node.property.name === "Option";
    }
    return false;
}
/** The name of the function whose body contains this node, if determinable.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The node whose enclosing function is sought.
 * @returns {string | null} The enclosing function's name, or null.
 */
function enclosingFunctionName(sourceCode, node) {
    const chain = ancestorsOf(sourceCode, node);
    for (let index = chain.length - 1; index >= 0; index--) {
        const current = chain[index];
        if (current.type === "FunctionDeclaration" && current.id !== null)
            return current.id.name;
        if ((current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") &&
            node !== current) {
            const name = current.type === "FunctionExpression" && current.id !== null
                ? current.id.name
                : variableDeclaratorName(sourceCode, current);
            if (name !== null)
                return name;
        }
    }
    return null;
}
/** The declared name of the variable a function expression initialises, if any.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The function expression node.
 * @returns {string | null} The initialising declarator's name, or null.
 */
function variableDeclaratorName(sourceCode, node) {
    const chain = ancestorsOf(sourceCode, node);
    for (let index = chain.length - 1; index >= 0; index--) {
        const current = chain[index];
        if (current.type === "Program")
            break;
        if (current.type === "VariableDeclarator" && current.id.type === "Identifier")
            return current.id.name;
    }
    return null;
}
/** The doctrine binds public APIs: walk up to see if this node is exported.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The node to test for export ancestry.
 * @returns {boolean} True when an export declaration encloses the node.
 */
function hasExportAncestor(sourceCode, node) {
    const chain = ancestorsOf(sourceCode, node);
    for (let index = chain.length - 1; index >= 0; index--) {
        const current = chain[index];
        if (current.type === "ExportNamedDeclaration" || current.type === "ExportDefaultDeclaration")
            return true;
        if (current.type === "Program")
            return false;
    }
    return false;
}
/** A return-type annotation naming Option<T>, e.g. `Option.Option<Account>`.
 *
 * @param {ESTree.TSType} type - The type node to inspect.
 * @returns {string | null} The Option spelling used, or null when not an Option reference.
 */
function optionTypeReference(type) {
    if (type.type !== "TSTypeReference")
        return null;
    const name = type.typeName;
    if (name.type === "Identifier" && name.name === "Option")
        return "Option";
    if (name.type === "TSQualifiedName" &&
        name.right.type === "Identifier" &&
        name.right.name === "Option") {
        return "Option.Option";
    }
    return null;
}
/**
 * Guarded operations must surface failure reasons as tagged MoneyError values
 * through the Effect error channel, not as bare Option.None which conflates
 * every possible why into one silent absence.
 */
export const guardedOpMustReturnEffectRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require guarded operations to fail with typed MoneyError reasons via Effect/Either instead of returning bare Option values.",
        },
        messages: {
            optionReturn: "`{{found}}` hides why the operation failed. Return `Effect.Effect<T, MoneyError>` (or `Either<T, MoneyError>` in sync cores) with Schema.TaggedError reasons so callers can match Overflow vs InvalidInput vs ZeroDivisor. Options buried in tuples, records or arrays hide it just as well.",
            bareNone: "`Option.none()` here discards the reason for failure. Fail with a tagged MoneyError reason instead, or keep the Option strictly internal while a converted public API owns the error channel.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ReturnStatement(node) {
                if (!hasExportAncestor(context.sourceCode, node))
                    return;
                if (enclosingFunctionName(context.sourceCode, node)?.endsWith("Option"))
                    return;
                const argument = node.argument;
                if (argument === null || argument === undefined)
                    return;
                let call = argument;
                while (call.type === "ParenthesizedExpression")
                    call = call.expression;
                if (call.type !== "CallExpression")
                    return;
                if (call.callee.type === "MemberExpression" &&
                    call.callee.property.type === "Identifier" &&
                    call.callee.property.name === "none" &&
                    isOptionObject(call.callee.object)) {
                    context.report({ node, messageId: "bareNone" });
                }
            },
            ArrowFunctionExpression(node) {
                if (!hasExportAncestor(context.sourceCode, node))
                    return;
                const parentId = variableDeclaratorName(context.sourceCode, node);
                if (parentId !== null && parentId.endsWith("Option"))
                    return;
                const annotation = node.returnType?.typeAnnotation;
                if (annotation === undefined)
                    return;
                const found = optionInReturnType(annotation);
                if (found !== null) {
                    context.report({ node: node.returnType ?? node, messageId: "optionReturn", data: { found } });
                }
            },
            FunctionDeclaration(node) {
                if (!hasExportAncestor(context.sourceCode, node))
                    return;
                checkFunctionReturn(context, node, node.id?.name ?? null);
            },
            FunctionExpression(node) {
                if (!hasExportAncestor(context.sourceCode, node))
                    return;
                checkFunctionReturn(context, node, node.id?.name ?? variableDeclaratorName(context.sourceCode, node));
            },
        };
    },
});
function checkFunctionReturn(context, node, idName) {
    if (idName !== null && idName.endsWith("Option"))
        return;
    const annotation = node.returnType?.typeAnnotation;
    if (annotation === undefined)
        return;
    const found = optionInReturnType(annotation);
    if (found !== null) {
        context.report({ node: node.returnType ?? node, messageId: "optionReturn", data: { found } });
    }
}
/** Search a type node for an embedded Option reference (tuples, arrays, members).
 *
 * @param {ESTree.TSType} type - The type node to search.
 * @returns {string | null} The first embedded Option spelling, or null when none.
 */
function findOptionType(type) {
    const direct = optionTypeReference(type);
    if (direct !== null)
        return direct;
    switch (type.type) {
        case "TSTupleType": {
            const render = (element) => {
                if ("elementType" in element)
                    return render(element.elementType);
                if (element.type === "TSOptionalType" || element.type === "TSRestType") {
                    return findOptionType(element.typeAnnotation);
                }
                return findOptionType(element);
            };
            for (const element of type.elementTypes) {
                const found = render(element);
                if (found !== null)
                    return found;
            }
            return null;
        }
        case "TSTypeOperator":
            return findOptionType(type.typeAnnotation);
        case "TSArrayType":
            return findOptionType(type.elementType);
        case "TSTypeLiteral":
            for (const member of type.members) {
                if (member.type !== "TSPropertySignature")
                    continue;
                const annotation = member.typeAnnotation?.typeAnnotation;
                if (annotation === undefined || annotation === null)
                    continue;
                const found = findOptionType(annotation);
                if (found !== null)
                    return found;
            }
            return null;
        default:
            return null;
    }
}
/** A return-type annotation hiding an Option anywhere: unions, tuples, arrays, members.
 *
 * @param {ESTree.TSType} annotation - The return-type annotation to search.
 * @returns {string | null} The Option spelling found, or null when none.
 */
function optionInReturnType(annotation) {
    let current = annotation;
    while (current.type === "TSParenthesizedType")
        current = current.typeAnnotation;
    if (current.type === "TSUnionType") {
        for (const member of current.types) {
            const found = optionTypeReference(member);
            if (found !== null)
                return found;
        }
    }
    return findOptionType(current);
}
