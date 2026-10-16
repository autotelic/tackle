/**
 * Meta-rules that keep rule authorship itself idiomatic (createOnce API, engine-native
 * traversal, RuleTester suites, property-based coverage). Opt-in: only meaningful in
 * lint-plugin codebases, so consumers enable `plumb-meta` deliberately.
 */
declare const plumbMetaPlugin: import("@oxlint/plugins").Plugin;
export default plumbMetaPlugin;
