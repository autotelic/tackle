import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.js";
function isEmptyObjectExpression(node) {
    return node.type === "ObjectExpression" && node.properties.length === 0;
}
/** Ban conditional empty-object spreads without changing their omission semantics. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Disallow object spreads that conditionally spread an empty object to omit fields.",
        },
        messages: {
            avoid: "This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.",
        },
    },
    createOnce(context) {
        return {
            SpreadElement(node) {
                const parent = ancestorsOf(context.sourceCode, node).at(-1);
                if (parent?.type !== "ObjectExpression")
                    return;
                let conditional = node.argument;
                while (conditional.type === "ParenthesizedExpression") {
                    conditional = conditional.expression;
                }
                const emptyObjectOmission = conditional.type === "ConditionalExpression" &&
                    (isEmptyObjectExpression(conditional.consequent) ||
                        isEmptyObjectExpression(conditional.alternate));
                if (emptyObjectOmission) {
                    context.report({ node, messageId: "avoid" });
                }
            },
        };
    },
});
