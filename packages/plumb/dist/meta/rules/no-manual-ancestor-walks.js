import { defineRule } from "@oxlint/plugins";
/** Hand-rolled `.parent` loops duplicate sourceCode.getAncestors and hide traversal intent. */
export const noManualAncestorWalksRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Disallow manual `.parent` walks; use `context.sourceCode.getAncestors(node)`.",
        },
        messages: {
            useGetAncestors: "Hand-rolled ancestor walking via `.parent` obscures traversal intent. Use `context.sourceCode.getAncestors(node)` (root-first array) and express the search declaratively.",
        },
    },
    createOnce(context) {
        return {
            MemberExpression(node) {
                if (node.computed)
                    return;
                if (node.property.type !== "Identifier")
                    return;
                if (node.property.name !== "parent")
                    return;
                context.report({ node, messageId: "useGetAncestors" });
            },
        };
    },
});
