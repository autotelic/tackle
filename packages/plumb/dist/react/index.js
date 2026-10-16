import { eslintCompatPlugin } from "@oxlint/plugins";
import { requireTripartiteContextRule } from "./rules/require-tripartite-context.js";
import { requireGuardedContextHookRule } from "./rules/require-guarded-context-hook.js";
import { requireDotNotationExportsRule } from "./rules/require-dot-notation-exports.js";
import { useEncapsulationRule } from "./rules/use-encapsulation.js";
/** Opt-in Oxlint rules for React composition (the "perfect component" contract). */
const plumbReactPlugin = eslintCompatPlugin({
    meta: { name: "plumb-react" },
    rules: {
        "require-tripartite-context": requireTripartiteContextRule,
        "require-guarded-context-hook": requireGuardedContextHookRule,
        "require-dot-notation-exports": requireDotNotationExportsRule,
        "use-encapsulation": useEncapsulationRule,
    },
});
export default plumbReactPlugin;
