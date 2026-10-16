import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import fc from "fast-check";
import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";
/** Wrap a raw createOnce rule in the compat layer so it can run anywhere.
 *
 * @param {string} name - The rule name to register under.
 * @param {unknown} rule - The raw rule implementation.
 * @returns {Rule} The compat-wrapped rule.
 */
export function wrap(name, rule) {
    const plugin = eslintCompatPlugin({ meta: { name: "plumb-test" }, rules: { [name]: rule } });
    return plugin.rules[name];
}
/** Drive a createOnce rule visitor directly against a synthetic node.
 *
 * @param {Rule} rule - The rule to probe.
 * @param {string} visitorKey - The visitor method name to invoke.
 * @param {unknown} node - The synthetic node passed to the visitor.
 * @returns {Array<Recorded>} Reports collected from the probe.
 */
export function collectReports(rule, visitorKey, node) {
    const reports = [];
    const visitor = wrap("probe", rule);
    visitor.create({ report: (d) => reports.push(d) })[visitorKey]?.(node);
    return reports;
}
/** Bind vitest reporting into RuleTester so suites run under the project runner.
 *
 * @returns {RuleTester} A RuleTester wired to vitest's describe/it.
 */
export function makeTester() {
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
export function memberExpression(computed, propertyName_) {
    return {
        type: "MemberExpression",
        computed,
        object: { type: "Identifier", name: "node" },
        property: { type: "Identifier", name: propertyName_ },
    };
}
export const identifiers = fc
    .stringMatching(/^[a-zA-Z_$][a-zA-Z0-9_$]{0,7}$/u)
    .filter((s) => !["const", "let", "var", "function", "class"].includes(s));
