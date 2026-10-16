import { defineRule } from "@oxlint/plugins";
/**
 * Canonical form requires intentional order. The default sort coerces
 * elements to strings and compares lexicographically, so the "natural"
 * ordering silently depends on element encoding; an explicit comparator
 * makes the canonical order deliberate and reviewable.
 */
export const requireSortComparatorRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require an explicit comparator on .sort()/.toSorted(); the default lexicographic sort makes canonical order accidental.",
        },
        messages: {
            missingComparator: "This sort has no comparator, so ordering defaults to string comparison and the canonical order is accidental. Pass an explicit comparator so the intended order is stated here.",
        },
    },
    createOnce(context) {
        return {
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type !== "MemberExpression" ||
                    callee.computed ||
                    callee.property.type !== "Identifier" ||
                    (callee.property.name !== "sort" && callee.property.name !== "toSorted")) {
                    return;
                }
                if (node.arguments.length === 0) {
                    context.report({ node, messageId: "missingComparator" });
                }
            },
        };
    },
});
