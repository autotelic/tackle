import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
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
/** Exported predicates should be typed P.Predicate<T> so they compose. */
export const preferEffectPredicateOverBooleanFunctionRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Prefer P.Predicate<T> over plain (value: T) => boolean for exported predicates so they compose with P.and/or/mapInput, Array.filter, and Option refinement.",
        },
        messages: {
            booleanPredicateReturn: "Export this predicate as P.Predicate<{{type}}> so it composes with P.and/or/mapInput, Array.filter, and Option refinement.",
        },
    },
    createOnce(context) {
        const checkPredicate = (node) => {
            if (node.returnType === null || node.returnType === undefined)
                return;
            const returnType = node.returnType.typeAnnotation;
            if (returnType.type !== "TSBooleanKeyword")
                return;
            if (node.params.length !== 1)
                return;
            const firstParam = node.params[0];
            if (firstParam === undefined)
                return;
            const annotation = parameterAnnotation(firstParam);
            if (annotation === null || annotation === undefined)
                return;
            const type = annotation.typeAnnotation;
            if (type.type === "TSUnknownKeyword")
                return;
            context.report({
                node: returnType,
                messageId: "booleanPredicateReturn",
                data: { type: context.sourceCode.getText(type) },
            });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ExportNamedDeclaration(node) {
                const declaration = node.declaration;
                if (declaration === null)
                    return;
                if (declaration.type === "FunctionDeclaration") {
                    checkPredicate(declaration);
                    return;
                }
                if (declaration.type !== "VariableDeclaration")
                    return;
                for (const declarator of declaration.declarations) {
                    const init = declarator.init;
                    if (init === null || init === undefined || init.type !== "ArrowFunctionExpression") {
                        continue;
                    }
                    checkPredicate(init);
                }
            },
        };
    },
});
