import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import fc from "fast-check";
import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";

import type { ESTree, Rule } from "@oxlint/plugins";

type Recorded = { messageId: string };

/** Wrap a raw createOnce rule in the compat layer so it can run anywhere.
 *
 * @param {string} name - The rule name to register under.
 * @param {unknown} rule - The raw rule implementation.
 * @returns {Rule} The compat-wrapped rule.
 */
export function wrap(name: string, rule: unknown): Rule {
	const plugin = eslintCompatPlugin({ meta: { name: "plumb-test" }, rules: { [name]: rule as unknown as Rule } });
	return plugin.rules[name] as unknown as Rule;
}

/** Drive a createOnce rule visitor directly against a synthetic node.
 *
 * @param {Rule} rule - The rule to probe.
 * @param {string} visitorKey - The visitor method name to invoke.
 * @param {unknown} node - The synthetic node passed to the visitor.
 * @returns {Array<Recorded>} Reports collected from the probe.
 */
export function collectReports(
	rule: Rule,
	visitorKey: string,
	node: unknown,
): Array<Recorded> {
	const reports: Array<Recorded> = [];
	const visitor = wrap("probe", rule) as unknown as {
		create: (context: unknown) => Record<string, (n: unknown) => void>;
	};
	visitor.create({ report: (d: Recorded) => reports.push(d) })[visitorKey]?.(node);
	return reports;
}

/** Bind vitest reporting into RuleTester so suites run under the project runner.
 *
 * @returns {RuleTester} A RuleTester wired to vitest's describe/it.
 */
export function makeTester(): RuleTester {
	RuleTester.describe = (name, fn) => describe(name, fn);
	RuleTester.it = (name, fn) => it(name, fn);
	return new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
}

/** Build an ESTree member expression on a fixed `node` object for visitor probes.
 *
 * @param {boolean} computed - Whether the member access is computed.
 * @param {string} propertyName_ - The property identifier name.
 * @returns {ESTree.Node} The synthetic member expression node.
 */
export function memberExpression(computed: boolean, propertyName_: string): ESTree.Node {
	return {
		type: "MemberExpression",
		computed,
		object: { type: "Identifier", name: "node" },
		property: { type: "Identifier", name: propertyName_ },
	} as unknown as ESTree.Node;
}

export const identifiers: fc.Arbitrary<string> = fc
	.stringMatching(/^[a-zA-Z_$][a-zA-Z0-9_$]{0,7}$/u)
	.filter((s) => !["const", "let", "var", "function", "class"].includes(s));
