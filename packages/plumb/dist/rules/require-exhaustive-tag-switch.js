import { defineRule } from "@oxlint/plugins";
const DISCRIMINANTS = new Set(["_tag", "tag"]);
/**
 * Bounded touch points: adding a variant should be caught by the compiler at
 * every place that must change. A `default` arm on a tag switch, even a
 * throwing one, silences that check, so unhandled variants slip through
 * silently or via hand-rolled fallbacks instead of failing type-check.
 */
export const requireExhaustiveTagSwitchRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Require `default`-free switches over a `_tag` discriminant so exhaustiveness checking flags every site a new variant must touch.",
        },
        messages: {
            noDefault: "This switch matches on `_tag` but has a `default` arm, which hides unhandled variants from exhaustiveness checking. Remove it and list every variant explicitly so adding one fails type-check here.",
        },
    },
    createOnce(context) {
        return {
            SwitchStatement(node) {
                const discriminant = node.discriminant;
                if (discriminant.type !== "MemberExpression" ||
                    discriminant.computed ||
                    discriminant.property.type !== "Identifier" ||
                    !DISCRIMINANTS.has(discriminant.property.name))
                    return;
                if (node.cases.some((clause) => clause.test === null)) {
                    context.report({ node, messageId: "noDefault" });
                }
            },
        };
    },
});
