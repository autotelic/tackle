import { defineRule } from "@oxlint/plugins";
const COMPARISON_OPERATORS = new Set(["===", "!==", "==", "!=", "<", ">", "<=", ">="]);
const CONSTRUCTOR_NAME = /^(?:make[A-Z]|make$|fromRaw|unsafeMake)/u;
function parameterAnnotation(parameter) {
    if (parameter.type === "TSParameterProperty") {
        return parameterAnnotation(parameter.parameter);
    }
    if (parameter.type === "RestElement") {
        return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
    }
    if (parameter.type === "AssignmentPattern") {
        return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
    }
    return parameter.typeAnnotation;
}
function referencedTypeName(type) {
    if (type.type === "TSParenthesizedType")
        return referencedTypeName(type.typeAnnotation);
    if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier")
        return null;
    return type.typeName.name;
}
function isLiteralExpression(expression) {
    if (expression.type === "Literal")
        return true;
    return (expression.type === "UnaryExpression" &&
        expression.operator === "-" &&
        expression.argument.type === "Literal");
}
function isParamField(payload) {
    const { expression, paramName } = payload;
    if (expression.type === "PrivateIdentifier")
        return false;
    if (expression.type !== "MemberExpression" || expression.object.type !== "Identifier") {
        return false;
    }
    if (expression.object.name !== paramName)
        return false;
    if (expression.computed)
        return expression.property.type === "Literal";
    return expression.property.type === "Identifier" || expression.property.type === "PrivateIdentifier";
}
function isFieldSignalBody(payload) {
    const { expression, paramName } = payload;
    if (expression.type === "LogicalExpression") {
        return (isFieldSignalBody({ expression: expression.left, paramName }) &&
            isFieldSignalBody({ expression: expression.right, paramName }));
    }
    if (expression.type === "UnaryExpression" && expression.operator === "!") {
        return isFieldSignalBody({ expression: expression.argument, paramName });
    }
    if (expression.type === "ParenthesizedExpression") {
        return isFieldSignalBody({ expression: expression.expression, paramName });
    }
    if (expression.type === "BinaryExpression" && COMPARISON_OPERATORS.has(expression.operator)) {
        const fieldOnLeft = isParamField({ expression: expression.left, paramName });
        const literalOnRight = isLiteralExpression(expression.right);
        const fieldOnRight = isParamField({ expression: expression.right, paramName });
        const literalOnLeft = isLiteralExpression(expression.left);
        return (fieldOnLeft && literalOnRight) || (fieldOnRight && literalOnLeft);
    }
    return false;
}
/**
 * Build a predicate-analysis candidate when the function reads as a boolean
 * classification derived solely from comparing one typed parameter's fields.
 *
 * @param {PredicateFunction} node - The exported function node under analysis.
 * @returns {PredicateCandidate | null} The candidate, or null when not a field-signal predicate.
 */
function candidateFrom(node) {
    if (node.returnType === null || node.returnType === undefined)
        return null;
    const returnType = node.returnType.typeAnnotation;
    if (returnType.type !== "TSBooleanKeyword")
        return null;
    if (node.params.length !== 1)
        return null;
    const firstParam = node.params[0];
    if (firstParam === undefined)
        return null;
    const annotation = parameterAnnotation(firstParam);
    if (annotation === null || annotation === undefined)
        return null;
    const typeName = referencedTypeName(annotation.typeAnnotation);
    if (typeName === null)
        return null;
    let body = null;
    if (node.body !== null && node.body !== undefined) {
        if (node.body.type === "BlockStatement") {
            const only = node.body.body.length === 1 ? node.body.body[0] : undefined;
            if (only !== undefined && only.type === "ReturnStatement" && only.argument !== null) {
                body = only.argument;
            }
        }
        else {
            body = node.body;
        }
    }
    if (body === null)
        return null;
    if (!isFieldSignalBody({
        expression: body,
        paramName: firstParam.type === "Identifier" ? firstParam.name : "",
    })) {
        return null;
    }
    return { node, typeName };
}
const AUXILIARIES = new Set(["is", "has", "can", "should", "was", "will", "did", "be", "the"]);
/** Split a camelCase/separator name into lowercase tokens, dropping auxiliary prefixes like `is`/`has`.
 *
 * @param {string} name - The name to tokenise.
 * @returns {string[]} Content-bearing lowercase tokens.
 */
function contentTokens(name) {
    return name
        .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .split(/[^a-zA-Z0-9]+/u)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0 && !AUXILIARIES.has(token));
}
/** Accept both `{ members }` and flattened `{ body }` shapes for an interface/type-literal body.
 *
 * @param {ESTree.TSInterfaceBody | ESTree.TSTypeLiteral} bodyNode - The declared body node.
 * @returns {ESTree.TSSignature[]} The signature list.
 */
function memberList(bodyNode) {
    const members = "body" in bodyNode ? bodyNode.body : bodyNode.members;
    return [...members];
}
/** Ban predicate families that re-derive classification, and un-guarded construction. */
export const noBooleanFieldSignalsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow families of exported predicates over one type that re-test the same fields, constructors that produce un-guarded values, and boolean state products on declared types; classify (parse) once.",
        },
        messages: {
            reportPredicate: "Predicates over `{{type}}` each re-derive classification from the same field comparisons. Classify the value once into a named union (or comparable structure) and derive the predicates from it.",
            booleanFieldSignals: "Predicates over `{{type}}` each re-derive classification from the same field comparisons. Classify the value once into a named union (or comparable structure) and derive the predicates from it.",
            unguardedConstructor: "`{{type}}` is constructed directly by `make` yet inspected by a predicate family. Make the constructor a parser (normalise or return Option) so invalid states can't be produced.",
            booleanStateProduct: "`{{name}}` carries {{count}} boolean {{kind}} admitting invalid combinations. Classify once into a named union over that state so impossible combinations can't be represented, and derive any predicates from it.",
        },
    },
    createOnce(context) {
        const pending = new Map();
        const reported = new Set();
        const constructors = new Map();
        const reportPredicate = (candidate) => {
            context.report({
                node: candidate.node,
                messageId: "booleanFieldSignals",
                data: { type: candidate.typeName },
            });
        };
        const flushConstructors = (typeName) => {
            const list = constructors.get(typeName);
            if (list === undefined)
                return;
            for (const node of list) {
                context.report({ node, messageId: "unguardedConstructor", data: { type: typeName } });
            }
            constructors.delete(typeName);
        };
        const recordPredicate = (candidate) => {
            if (candidate === null)
                return;
            if (reported.has(candidate.typeName)) {
                reportPredicate(candidate);
                return;
            }
            const first = pending.get(candidate.typeName);
            if (first !== undefined) {
                reportPredicate(first);
                reportPredicate(candidate);
                reported.add(candidate.typeName);
                pending.delete(candidate.typeName);
                flushConstructors(candidate.typeName);
                return;
            }
            pending.set(candidate.typeName, candidate);
        };
        const recordConstructor = (typeName, node) => {
            if (typeName === null)
                return;
            if (reported.has(typeName)) {
                context.report({ node, messageId: "unguardedConstructor", data: { type: typeName } });
                return;
            }
            const list = constructors.get(typeName) ?? [];
            list.push(node);
            constructors.set(typeName, list);
        };
        const checkDeclaredBody = (reportNode, members, typeName) => {
            const booleanNames = members.flatMap((member) => {
                if (member.type !== "TSPropertySignature")
                    return [];
                if (member.typeAnnotation?.typeAnnotation.type !== "TSBooleanKeyword")
                    return [];
                return member.key.type === "Identifier" ? [member.key.name] : [];
            });
            if (booleanNames.length >= 3) {
                context.report({
                    node: reportNode,
                    messageId: "booleanStateProduct",
                    data: { name: typeName, count: String(booleanNames.length), kind: "flags" },
                });
                return;
            }
            for (let i = 0; i < booleanNames.length; i += 1) {
                for (let j = i + 1; j < booleanNames.length; j += 1) {
                    const first = contentTokens(booleanNames[i] ?? "");
                    const second = contentTokens(booleanNames[j] ?? "");
                    const shared = first.find((token) => second.includes(token));
                    if (shared === undefined)
                        continue;
                    context.report({
                        node: reportNode,
                        messageId: "booleanStateProduct",
                        data: { name: `${booleanNames[i]}/${booleanNames[j]}`, count: "2", kind: `flags over \`${shared}\`` },
                    });
                    return;
                }
            }
        };
        const handle = (name, fn, rawNode) => {
            const firstParameter = fn.params[0];
            const boundParameter = firstParameter === undefined
                ? null
                : firstParameter.type === "Identifier"
                    ? firstParameter.name
                    : firstParameter.type === "AssignmentPattern" && firstParameter.left.type === "Identifier"
                        ? firstParameter.left.name
                        : null;
            if (boundParameter !== null)
                recordPredicate(candidateFrom(fn));
            const declaredReturn = fn.returnType === null || fn.returnType === undefined
                ? null
                : referencedTypeName(fn.returnType.typeAnnotation);
            const ctorReturn = CONSTRUCTOR_NAME.test(name) ? declaredReturn : null;
            if (ctorReturn !== null &&
                (fn.type === "FunctionDeclaration" || fn.type === "FunctionExpression") &&
                fn.id !== null) {
                recordConstructor(ctorReturn, fn);
            }
        };
        return {
            ExportNamedDeclaration(node) {
                const declaration = node.declaration;
                if (declaration === null)
                    return;
                if (declaration.type === "FunctionDeclaration") {
                    if (declaration.id !== null)
                        handle(declaration.id.name, declaration, declaration);
                    return;
                }
                if (declaration.type !== "VariableDeclaration")
                    return;
                for (const declarator of declaration.declarations) {
                    const init = declarator.init;
                    if (init === null || init === undefined || init.type !== "ArrowFunctionExpression")
                        continue;
                    if (declarator.id.type !== "Identifier")
                        continue;
                    handle(declarator.id.name, init, declarator);
                }
            },
            TSInterfaceDeclaration(node) {
                checkDeclaredBody(node, memberList(node.body), node.id.type === "Identifier" ? node.id.name : "anonymous interface");
            },
            TSTypeAliasDeclaration(node) {
                if (node.typeAnnotation.type !== "TSTypeLiteral")
                    return;
                checkDeclaredBody(node, node.typeAnnotation.members, node.id.name);
            },
        };
    },
});
