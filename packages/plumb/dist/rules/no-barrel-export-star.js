import { defineRule } from "@oxlint/plugins";
/** Barrel `export *` erases the names it forwards, forcing search-driven readers back inside the package. */
export const noBarrelExportStarRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow `export * from ...` re-exports because the star erases forwarded names; an agent navigating by text search cannot resolve which module owns a symbol and must re-grep inside the package.",
        },
        messages: {
            erasesForwardedNames: "`export * from '{{source}}'` erases the names it forwards; readers resolving a symbol through this barrel must grep inside the package instead. Re-export the explicit names.",
        },
    },
    createOnce(context) {
        return {
            ExportAllDeclaration(node) {
                if (node.exported !== null && node.exported !== undefined)
                    return;
                context.report({
                    node,
                    messageId: "erasesForwardedNames",
                    data: { source: String(node.source.value) },
                });
            },
        };
    },
});
