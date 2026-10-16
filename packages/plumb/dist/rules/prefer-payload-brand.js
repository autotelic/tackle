import { defineRule } from "@oxlint/plugins";
/** True for a heritage clause referencing Brand.Brand (any ESTree spelling).
 *
 * @param {ESTree.TSTypeName | ESTree.Expression | ESTree.PrivateIdentifier} expression - Heritage clause expression.
 * @returns {boolean} True when the expression is the Brand.Brand reference.
 */
function isBrandBrandReference(expression) {
    if (expression.type === "TSQualifiedName") {
        return (expression.left.type === "Identifier" &&
            expression.left.name === "Brand" &&
            expression.right.type === "Identifier" &&
            expression.right.name === "Brand");
    }
    if (expression.type === "MemberExpression") {
        return (expression.object.type === "Identifier" &&
            expression.object.name === "Brand" &&
            expression.property.type === "Identifier" &&
            expression.property.name === "Brand");
    }
    return false;
}
/** Opaque brand interfaces hide their payload behind casts; carry the payload in the brand. */
export const preferPayloadBrandRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Prefer payload-carrying brands (type X = Base & Brand.Brand<\"X\">) over opaque brand interfaces so the payload stays recoverable without type assertions.",
        },
        messages: {
            opaqueBrand: "Opaque brand interface `{{name}}` hides its payload behind casts. Carry the payload in the brand instead: `type {{name}} = Base & Brand.Brand<\"{{name}}\">` with a cast-free `un{{name}}` accessor.",
        },
    },
    createOnce(context) {
        return {
            Program(node) {
                for (const statement of node.body) {
                    const declaration = statement.type === "ExportNamedDeclaration" ||
                        statement.type === "ExportDefaultDeclaration"
                        ? (statement.declaration ?? null)
                        : statement;
                    if (declaration?.type !== "TSInterfaceDeclaration")
                        continue;
                    const heritages = declaration.extends ?? [];
                    if (heritages.length !== 1)
                        continue;
                    if (!isBrandBrandReference(heritages[0].expression))
                        continue;
                    context.report({
                        node: declaration.id,
                        messageId: "opaqueBrand",
                        data: { name: declaration.id.name },
                    });
                }
            },
        };
    },
});
