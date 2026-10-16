import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.js";
const functionBoundaryTypes = new Set([
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "FunctionExpression",
    "TSDeclareFunction",
    "TSEmptyBodyFunctionExpression",
]);
function unwrapExpressionParentheses(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression")
        current = current.expression;
    return current;
}
function unwrapTypeParentheses(type) {
    let current = type;
    while (current.type === "TSParenthesizedType")
        current = current.typeAnnotation;
    return current;
}
function typeReferenceName(type) {
    return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
function isUnknownOrAnyType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    return unwrapped.type === "TSUnknownKeyword" || unwrapped.type === "TSAnyKeyword";
}
function isBroadRecordKeyType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSStringKeyword" ||
        unwrapped.type === "TSNumberKeyword" ||
        unwrapped.type === "TSSymbolKeyword") {
        return true;
    }
    if (unwrapped.type === "TSUnionType")
        return unwrapped.types.every(isBroadRecordKeyType);
    return unwrapped.type === "TSTypeReference" && typeReferenceName(unwrapped) === "PropertyKey";
}
function isBroadRecordType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeReference") {
        if (typeReferenceName(unwrapped) === "Readonly") {
            const [inner] = unwrapped.typeArguments?.params ?? [];
            return inner !== undefined && isBroadRecordType(inner);
        }
        if (typeReferenceName(unwrapped) !== "Record")
            return false;
        const parameters = unwrapped.typeArguments?.params ?? [];
        return (parameters.length === 2 &&
            parameters[0] !== undefined &&
            parameters[1] !== undefined &&
            isBroadRecordKeyType(parameters[0]) &&
            isUnknownOrAnyType(parameters[1]));
    }
    if (unwrapped.type !== "TSTypeLiteral" || unwrapped.members.length !== 1)
        return false;
    const [member] = unwrapped.members;
    const [parameter] = member?.type === "TSIndexSignature" ? member.parameters : [];
    return (member?.type === "TSIndexSignature" &&
        member.parameters.length === 1 &&
        parameter !== undefined &&
        isBroadRecordKeyType(parameter.typeAnnotation.typeAnnotation) &&
        isUnknownOrAnyType(member.typeAnnotation.typeAnnotation));
}
function broadTypeKind(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSUnknownKeyword" || unwrapped.type === "TSAnyKeyword")
        return "top";
    if (unwrapped.type === "TSObjectKeyword")
        return "object";
    return isBroadRecordType(unwrapped) ? "record" : null;
}
function assertedExpression(node) {
    return unwrapExpressionParentheses(node.expression);
}
function isDefinitelyObjectType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    switch (unwrapped.type) {
        case "TSArrayType":
        case "TSConstructorType":
        case "TSFunctionType":
        case "TSMappedType":
        case "TSObjectKeyword":
        case "TSTupleType":
            return true;
        case "TSTypeLiteral":
            return unwrapped.members.length > 0;
        case "TSIntersectionType":
            return unwrapped.types.every(isDefinitelyObjectType);
        case "TSTypeOperator":
            return unwrapped.operator === "readonly" && isDefinitelyObjectType(unwrapped.typeAnnotation);
        default:
            return false;
    }
}
function isDefinitelyNarrowerRecordType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type !== "TSIndexSignature");
    }
    if (unwrapped.type !== "TSTypeReference")
        return false;
    if (typeReferenceName(unwrapped) === "Readonly") {
        const [inner] = unwrapped.typeArguments?.params ?? [];
        return inner !== undefined && isDefinitelyNarrowerRecordType(inner);
    }
    if (typeReferenceName(unwrapped) !== "Record")
        return false;
    const parameters = unwrapped.typeArguments?.params ?? [];
    return (parameters.length === 2 && parameters[1] !== undefined && !isUnknownOrAnyType(parameters[1]));
}
function functionBoundary(sourceCode, node) {
    const ancestors = ancestorsOf(sourceCode, node);
    for (let index = ancestors.length - 1; index >= 0; index--) {
        const current = ancestors[index];
        if (current.type === "Program")
            break;
        if (functionBoundaryTypes.has(current.type))
            return current;
    }
    return null;
}
function resolvedVariableForIdentifier(scopes, identifier) {
    for (const scope of scopes) {
        const reference = scope.references.find((candidate) => candidate.identifier.start === identifier.start &&
            candidate.identifier.end === identifier.end);
        if (reference !== undefined)
            return reference.resolved;
    }
    return null;
}
function variableDeclarator(variable) {
    for (const definition of variable.defs) {
        if (definition.type === "Variable" && definition.node.type === "VariableDeclarator") {
            return definition.node;
        }
    }
    return null;
}
function knownValueEvidence(sourceCode, expression, scopes, boundary, visitedVariables) {
    const unwrapped = unwrapExpressionParentheses(expression);
    if (unwrapped.type === "TSAsExpression" || unwrapped.type === "TSTypeAssertion") {
        if (broadTypeKind(unwrapped.typeAnnotation) !== null)
            return null;
        return { type: unwrapped.typeAnnotation };
    }
    if (unwrapped.type === "Literal" || unwrapped.type === "TemplateLiteral") {
        return { type: null };
    }
    if (unwrapped.type === "ArrayExpression" ||
        unwrapped.type === "ArrowFunctionExpression" ||
        unwrapped.type === "ClassExpression" ||
        unwrapped.type === "FunctionExpression" ||
        unwrapped.type === "NewExpression" ||
        unwrapped.type === "ObjectExpression") {
        return { type: null };
    }
    if (unwrapped.type !== "Identifier")
        return null;
    const variable = resolvedVariableForIdentifier(scopes, unwrapped);
    if (variable === null || visitedVariables.has(variable))
        return null;
    const annotatedIdentifier = variable.identifiers.find((identifier) => identifier.typeAnnotation !== null && identifier.typeAnnotation !== undefined);
    const annotation = annotatedIdentifier?.typeAnnotation?.typeAnnotation;
    if (annotation !== undefined && annotatedIdentifier !== undefined) {
        if (functionBoundary(sourceCode, annotatedIdentifier) !== boundary || broadTypeKind(annotation) !== null) {
            return null;
        }
        return { type: annotation };
    }
    const declarator = variableDeclarator(variable);
    const declaration = declarator === null ? null : ancestorsOf(sourceCode, declarator).at(-1);
    if (declarator === null ||
        declaration === null ||
        declaration?.type !== "VariableDeclaration" ||
        declaration?.kind !== "const" ||
        declarator.init === null ||
        variable.references.some((reference) => reference.isWrite() && !reference.init) ||
        functionBoundary(sourceCode, declarator) !== boundary) {
        return null;
    }
    return knownValueEvidence(sourceCode, declarator.init, scopes, boundary, new Set([...visitedVariables, variable]));
}
/** Detect immutable local bindings that erase a known type and are later asserted back to a narrower type. */
export const noWidenThenAssertRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type.",
        },
        messages: {
            widenThenAssert: 'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
        },
    },
    createOnce(context) {
        let scopes = [];
        const checkAssertion = (node) => {
            const expression = assertedExpression(node);
            if (expression.type !== "Identifier")
                return;
            const variable = resolvedVariableForIdentifier(scopes, expression);
            if (variable === null)
                return;
            const declarator = variableDeclarator(variable);
            const declaration = declarator === null ? null : ancestorsOf(context.sourceCode, declarator).at(-1);
            if (declarator === null ||
                declaration === null ||
                declaration?.type !== "VariableDeclaration" ||
                declaration?.kind !== "const" ||
                declarator.id.type !== "Identifier" ||
                declarator.init === null ||
                variable.references.some((reference) => reference.isWrite() && !reference.init)) {
                return;
            }
            const boundary = functionBoundary(context.sourceCode, declarator);
            const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
            const initializerUnwrapped = unwrapExpressionParentheses(declarator.init);
            const initializerAssertion = initializerUnwrapped.type === "TSAsExpression" || initializerUnwrapped.type === "TSTypeAssertion"
                ? initializerUnwrapped
                : null;
            const initializerBroadKind = initializerAssertion === null ? null : broadTypeKind(initializerAssertion.typeAnnotation);
            const declaredBroadKind = declaredType === undefined ? null : broadTypeKind(declaredType);
            const broadKind = declaredBroadKind ?? initializerBroadKind;
            if (broadKind === null)
                return;
            const originalExpression = initializerAssertion !== null && initializerBroadKind !== null
                ? assertedExpression(initializerAssertion)
                : declarator.init;
            const evidence = knownValueEvidence(context.sourceCode, originalExpression, scopes, boundary, new Set([variable]));
            if (evidence === null)
                return;
            if (node.start <= declarator.end || functionBoundary(context.sourceCode, node) !== boundary) {
                return;
            }
            const assertedType = node.typeAnnotation;
            if (broadTypeKind(assertedType) !== null)
                return;
            if (broadKind !== "top") {
                const normalized = (type) => context.sourceCode.text.slice(type.start, type.end).replaceAll(/\s+/gu, "");
                const sameSyntax = evidence.type !== null &&
                    normalized(unwrapTypeParentheses(evidence.type)) ===
                        normalized(unwrapTypeParentheses(assertedType));
                if (!sameSyntax) {
                    if (broadKind === "object") {
                        if (!isDefinitelyObjectType(assertedType))
                            return;
                    }
                    else if (!isDefinitelyNarrowerRecordType(assertedType)) {
                        return;
                    }
                }
            }
            context.report({
                node,
                messageId: "widenThenAssert",
                data: { name: expression.name },
            });
        };
        return {
            Program() {
                scopes = context.sourceCode.scopeManager.scopes;
            },
            TSAsExpression: checkAssertion,
            TSTypeAssertion: checkAssertion,
        };
    },
});
