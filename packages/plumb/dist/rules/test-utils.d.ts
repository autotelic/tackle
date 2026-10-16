import fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import type { ESTree, Rule } from "@oxlint/plugins";
type Recorded = {
    messageId: string;
};
/** Wrap a raw createOnce rule in the compat layer so it can run anywhere.
 *
 * @param {string} name - The rule name to register under.
 * @param {unknown} rule - The raw rule implementation.
 * @returns {Rule} The compat-wrapped rule.
 */
export declare function wrap(name: string, rule: unknown): Rule;
/** Drive a createOnce rule visitor directly against a synthetic node.
 *
 * @param {Rule} rule - The rule to probe.
 * @param {string} visitorKey - The visitor method name to invoke.
 * @param {unknown} node - The synthetic node passed to the visitor.
 * @returns {Array<Recorded>} Reports collected from the probe.
 */
export declare function collectReports(rule: Rule, visitorKey: string, node: unknown): Array<Recorded>;
/** Bind vitest reporting into RuleTester so suites run under the project runner.
 *
 * @returns {RuleTester} A RuleTester wired to vitest's describe/it.
 */
export declare function makeTester(): RuleTester;
/** Build an ESTree member expression on a fixed `node` object for visitor probes.
 *
 * @param {boolean} computed - Whether the member access is computed.
 * @param {string} propertyName_ - The property identifier name.
 * @returns {ESTree.Node} The synthetic member expression node.
 */
export declare function memberExpression(computed: boolean, propertyName_: string): ESTree.Node;
export declare const identifiers: fc.Arbitrary<string>;
export {};
