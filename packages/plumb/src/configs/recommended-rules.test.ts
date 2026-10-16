import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Rule } from "@oxlint/plugins";

import plumbPlugin from "../index.ts";
import plumbEffectPlugin from "../effect/index.ts";
import plumbReactPlugin from "../react/index.ts";
import {
	plumbEffectRecommendedRules,
	plumbReactRecommendedRules,
	plumbRecommendedRules,
	recommendedRulesFor,
} from "./recommended-rules.ts";

describe("recommendedRulesFor", () => {
	it("enables exactly the plugin's rules, namespaced by the plugin name, at error", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z][a-z-]{0,11}$/u),
				fc.uniqueArray(fc.stringMatching(/^[a-z][a-z-]{0,15}$/u), { maxLength: 8 }),
				(name, ruleNames) => {
					const plugin = { meta: { name }, rules: Object.fromEntries(ruleNames.map((rule) => [rule, {} as Rule])) };
					const rules = recommendedRulesFor(plugin);
					expect(new Set(Object.keys(rules))).toEqual(new Set(ruleNames.map((rule) => `${name}/${rule}`)));
					expect(new Set(Object.values(rules))).toEqual(new Set(ruleNames.length === 0 ? [] : ["error"]));
				},
			),
		);
	});

	it("covers every rule each shipped plugin registers", () => {
		expect(Object.keys(plumbRecommendedRules)).toHaveLength(Object.keys(plumbPlugin.rules).length);
		expect(Object.keys(plumbEffectRecommendedRules)).toHaveLength(Object.keys(plumbEffectPlugin.rules).length);
		expect(Object.keys(plumbReactRecommendedRules)).toHaveLength(Object.keys(plumbReactPlugin.rules).length);
	});
});

describe("running under ESLint", () => {
	it("loads every plugin with the shared rule sets and reports findings", () => {
		// SAFETY: Oxlint's Plugin type allows `meta.fixable: null`, which ESLint's
		// type omits; the runtime shapes are what ESLint consumes.
		const plugins = {
			plumb: plumbPlugin,
			"plumb-effect": plumbEffectPlugin,
			"plumb-react": plumbReactPlugin,
		} as unknown as NonNullable<Linter.Config["plugins"]>;
		const linter = new Linter({ configType: "flat" });
		const messages = linter.verify(
			`type A = "x" | "y";\ntype B = "y" | "x";\n`,
			[
				{
					files: ["**/*.ts"],
					languageOptions: { parser: tsParser },
					plugins,
					rules: { ...plumbRecommendedRules, ...plumbEffectRecommendedRules, ...plumbReactRecommendedRules },
				},
			],
			"src/aliases.ts",
		);
		expect(messages.filter((message) => message.fatal === true)).toEqual([]);
		expect(messages.map((message) => message.ruleId)).toContain("plumb/no-duplicated-literal-union");
	});
});
