import type { Plugin } from "@oxlint/plugins";

import plumbPlugin from "../index.ts";
import plumbEffectPlugin from "../effect/index.ts";
import plumbReactPlugin from "../react/index.ts";

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
export function recommendedRulesFor(plugin: RuleSetSource): Readonly<Record<string, "error">> {
	const name = plugin.meta?.name ?? "";
	return Object.fromEntries(Object.keys(plugin.rules).map((rule) => [`${name}/${rule}`, "error" as const]));
}

/** Every `plumb` rule at `error`. */
export const plumbRecommendedRules = recommendedRulesFor(plumbPlugin);

/** Every `plumb-effect` rule at `error`; enable only in repos that depend on `effect`. */
export const plumbEffectRecommendedRules = recommendedRulesFor(plumbEffectPlugin);

/** Every `plumb-react` rule at `error`; enable only in React repos. */
export const plumbReactRecommendedRules = recommendedRulesFor(plumbReactPlugin);
