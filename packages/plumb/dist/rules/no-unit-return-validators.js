import { defineRule } from "@oxlint/plugins";
const VALIDATOR_NAME = /^(?:validate|check|ensure)/u;
/**
 * Whether a validator function declares void/undefined as its return type.
 *
 * @param {ValidatorFunction} node - The function-like node to inspect.
 * @returns {boolean} True when the return annotation is void or undefined.
 */
function returnsVoid(node) {
    const annotation = node.returnType;
    if (annotation === null || annotation === undefined)
        return false;
    const type = annotation.typeAnnotation;
    if (type.type === "TSVoidKeyword" || type.type === "TSUndefinedKeyword")
        return true;
    if (type.type === "TSParenthesizedType") {
        const inner = type.typeAnnotation;
        return inner.type === "TSVoidKeyword" || inner.type === "TSUndefinedKeyword";
    }
    return false;
}
/** Validators that return nothing throw away what they just learned. */
export const noUnitReturnValidatorsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow validators that return nothing (void/undefined); a check should preserve what it learned by returning the refined value.",
        },
        messages: {
            unitValidator: "`{{name}}` validates and returns nothing (void). Return the refined value (Option/parsed type) so the knowledge survives: parse, don't validate.",
        },
    },
    createOnce(context) {
        const report = (name, node, validator) => {
            if (!VALIDATOR_NAME.test(name))
                return;
            if (!returnsVoid(validator))
                return;
            context.report({ node, messageId: "unitValidator", data: { name } });
        };
        return {
            ExportNamedDeclaration(node) {
                const declaration = node.declaration;
                if (declaration === null)
                    return;
                if (declaration.type === "FunctionDeclaration") {
                    if (declaration.id !== null)
                        report(declaration.id.name, declaration, declaration);
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
                    report(declarator.id.name, declarator, init);
                }
            },
        };
    },
});
