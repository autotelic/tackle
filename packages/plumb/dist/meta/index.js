import { eslintCompatPlugin } from "@oxlint/plugins";
import { noDisableDirectivesRule } from "./rules/no-disable-directives.js";
import { noManualAncestorWalksRule } from "./rules/no-manual-ancestor-walks.js";
import { preferBeforeFileScopeRule } from "./rules/prefer-before-file-scope.js";
import { requireCreateOnceRule } from "./rules/require-create-once.js";
import { requireRuleTesterRule } from "./rules/require-rule-tester.js";
/**
 * Meta-rules that keep rule authorship itself idiomatic (createOnce API, engine-native
 * traversal, RuleTester suites, property-based coverage). Opt-in: only meaningful in
 * lint-plugin codebases, so consumers enable `plumb-meta` deliberately.
 */
const plumbMetaPlugin = eslintCompatPlugin({
    meta: { name: "plumb-meta" },
    rules: {
        "no-disable-directives": noDisableDirectivesRule,
        "no-manual-ancestor-walks": noManualAncestorWalksRule,
        "prefer-before-file-scope": preferBeforeFileScopeRule,
        "require-create-once": requireCreateOnceRule,
        "require-rule-tester": requireRuleTesterRule,
    },
});
export default plumbMetaPlugin;
