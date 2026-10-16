import type { Plugin } from "@oxlint/plugins";
/** The parts of a plugin a shared rule set is derived from. */
type RuleSetSource = Pick<Plugin, "meta" | "rules">;
/** Every rule a plugin ships, enabled at `error` under the plugin's own name.
 *
 * The keys assume the plugin is registered under `meta.name` (`plumb`,
 * `plumb-effect`, `plumb-react`), in `jsPlugins` for Oxlint or `plugins` for
 * ESLint. The result drops straight into either linter's `rules` object.
 *
 * @param {RuleSetSource} plugin - The plugin whose rules to enable.
 * @returns {Readonly<Record<string, "error">>} Namespaced rule ids mapped to `error`.
 */
export declare function recommendedRulesFor(plugin: RuleSetSource): Readonly<Record<string, "error">>;
/** Every `plumb` rule at `error`. */
export declare const plumbRecommendedRules: Readonly<Record<string, "error">>;
/** Every `plumb-effect` rule at `error`; enable only in repos that depend on `effect`. */
export declare const plumbEffectRecommendedRules: Readonly<Record<string, "error">>;
/** Every `plumb-react` rule at `error`; enable only in React repos. */
export declare const plumbReactRecommendedRules: Readonly<Record<string, "error">>;
export {};
