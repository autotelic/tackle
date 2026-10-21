import plumbPlugin from "../index.js";
import plumbEffectPlugin from "../effect/index.js";
import plumbReactPlugin from "../react/index.js";
/** Every rule a plugin ships, enabled at `error` under the plugin's own name.
 *
 * The keys assume the plugin is registered under `meta.name` (`plumb`,
 * `plumb-effect`, `plumb-react`), in `jsPlugins` for Oxlint or `plugins` for
 * ESLint. The result drops straight into either linter's `rules` object.
 *
 * @param {RuleSetSource} plugin - The plugin whose rules to enable.
 * @returns {Readonly<Record<string, "error">>} Namespaced rule ids mapped to `error`.
 */
export function recommendedRulesFor(plugin) {
    const name = plugin.meta?.name ?? "";
    return Object.fromEntries(Object.keys(plugin.rules).map((rule) => [`${name}/${rule}`, "error"]));
}
/** The severity a rule's own metadata asks for: a `problem` is an error, anything else a warning.
 *
 * This mirrors how Oxlint's own categories and the Effect language service's presets
 * split their rulebooks, so a rule that merely suggests a shape does not fail a build
 * the way a rule that catches a defect does.
 *
 * @param {unknown} rule - A rule definition from a plugin's `rules` record.
 * @returns {"error" | "warn"} The severity for that rule.
 */
function severityOfMetaType(rule) {
    const type = rule.meta?.type;
    return type === "problem" ? "error" : "warn";
}
/** Every rule a plugin ships, at the severity its own `meta.type` asks for.
 *
 * A `problem` is an error; a `suggestion` (or any other type) is a warning. Same
 * namespacing as {@link recommendedRulesFor}, so the two are interchangeable in a
 * config that wants the split rather than a flat `error`.
 *
 * @param {RuleSetSource} plugin - The plugin whose rules to enable.
 * @returns {Readonly<Record<string, "error" | "warn">>} Namespaced rule ids mapped to severity.
 */
export function rulesByMetaTypeFor(plugin) {
    const name = plugin.meta?.name ?? "";
    return Object.fromEntries(Object.entries(plugin.rules).map(([rule, definition]) => [
        `${name}/${rule}`,
        severityOfMetaType(definition),
    ]));
}
/** Every `plumb` rule at `error`. */
export const plumbRecommendedRules = recommendedRulesFor(plumbPlugin);
/** Every `plumb-effect` rule at `error`; enable only in repos that depend on `effect`. */
export const plumbEffectRecommendedRules = recommendedRulesFor(plumbEffectPlugin);
/** Every `plumb-react` rule at `error`; enable only in React repos. */
export const plumbReactRecommendedRules = recommendedRulesFor(plumbReactPlugin);
/** Every `plumb` rule at the severity its own metadata asks for. */
export const plumbRulesByMetaType = rulesByMetaTypeFor(plumbPlugin);
/** Every `plumb-effect` rule at the severity its own metadata asks for. */
export const plumbEffectRulesByMetaType = rulesByMetaTypeFor(plumbEffectPlugin);
/** Every `plumb-react` rule at the severity its own metadata asks for. */
export const plumbReactRulesByMetaType = rulesByMetaTypeFor(plumbReactPlugin);
