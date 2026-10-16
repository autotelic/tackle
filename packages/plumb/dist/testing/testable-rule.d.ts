import { RuleTester } from "oxlint/plugins-dev";
import type { Rule } from "@oxlint/plugins";
/**
 * Structural surface of a test runner, satisfied by vitest's `describe`/`it`/
 * `it.only` (and by jest/mocha equivalents).
 */
export interface TestRunner {
    describe: (name: string, fn: () => void) => void;
    it: (name: string, fn: () => void) => void;
    itOnly?: (name: string, fn: () => void) => void;
}
/** Bind a test runner's hooks to RuleTester's statics.
 *
 * Call once at module scope of a test file (or setup file) before running suites.
 *
 * @param {TestRunner} runner - The ambient runner's hooks.
 */
export declare function wireRuleTester(runner: TestRunner): void;
/** A tester instance bound to the wired runner.
 *
 * @returns {RuleTester} A fresh RuleTester.
 */
export declare function createTester(): RuleTester;
/**
 * Adapt a `createOnce` rule for Oxlint's RuleTester.
 *
 * RuleTester drives rules through their ESLint-compatible `create` method and
 * does not understand `before`/`after` lifecycle hooks. The adapter invokes
 * `createOnce` once per linted file (fresh state per file, exactly like native
 * Oxlint), honours the skip contract (`before` returning `false` skips the
 * file), and chains the rule's own `Program:exit` visitor with the after hook
 * instead of clobbering it.
 *
 * @param {CreateOnceRule | Rule} rule - The createOnce-style rule to adapt. A
 * rule already in ESLint-style passes through untouched.
 * @returns {Rule} An ESLint-compatible rule with an identical per-file lifecycle.
 */
export declare function testableRule(rule: Rule): Rule;
