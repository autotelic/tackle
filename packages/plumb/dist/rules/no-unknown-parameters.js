import { defineRule } from "@oxlint/plugins";
/** Unwrap parameter-property/rest/default wrappers to the declared annotation.
 *
 * @param {Parameter} parameter - The parameter pattern to inspect.
 * @returns {ESTree.TSTypeAnnotation | null | undefined} The declared type annotation, if any.
 */
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
/** Render a parameter's source name for reporting.
 *
 * @param {{ parameter: Parameter; sourceText: string }} payload - The pattern and its source text.
 * @returns {string} The bound identifier's name, or the raw unknown-annotated text.
 */
function parameterName(payload) {
    const { parameter, sourceText } = payload;
    if (parameter.type === "TSParameterProperty") {
        return parameterName({ parameter: parameter.parameter, sourceText });
    }
    if (parameter.type === "AssignmentPattern") {
        return parameterName({ parameter: parameter.left, sourceText });
    }
    if (parameter.type === "RestElement") {
        return parameterName({ parameter: parameter.argument, sourceText });
    }
    return parameter.type === "Identifier"
        ? parameter.name
        : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}
/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow explicitly unknown function parameters except `cause`; decode unknown input at its I/O boundary instead.",
        },
        messages: {
            unknownParameter: "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
        },
    },
    createOnce(context) {
        const checkParameters = (node) => {
            for (const parameter of node.params) {
                const annotation = parameterAnnotation(parameter);
                if (annotation?.typeAnnotation.type !== "TSUnknownKeyword")
                    continue;
                const name = parameterName({
                    parameter,
                    sourceText: context.sourceCode.getText(parameter),
                });
                if (name === "cause")
                    continue;
                context.report({
                    node: annotation.typeAnnotation,
                    messageId: "unknownParameter",
                    data: { parameter: name },
                });
            }
        };
        return {
            ArrowFunctionExpression: checkParameters,
            FunctionDeclaration: checkParameters,
            FunctionExpression: checkParameters,
            TSCallSignatureDeclaration: checkParameters,
            TSConstructSignatureDeclaration: checkParameters,
            TSConstructorType: checkParameters,
            TSDeclareFunction: checkParameters,
            TSEmptyBodyFunctionExpression: checkParameters,
            TSFunctionType: checkParameters,
            TSMethodSignature: checkParameters,
        };
    },
});
