import { RuleTester } from "oxlint/plugins-dev";

import type { CreateOnceRule, Rule } from "@oxlint/plugins";

/**
 * Structural surface of a test runner, satisfied by vitest's `describe`/`it`/
 * `it.only` (and by jest/mocha equivalents).
 */
export interface TestRunner {
	describe: (name: string, fn: () => void) => void;
	it: (name: string, fn: () => void) => void;
	itOnly?: (name: string, fn: () => void) => void;
}

/** Narrow to the createOnce surface the tester adapts.
 *
 * @param {Rule} rule - The rule to test.
 * @returns {boolean} True when the rule carries a createOnce factory.
 */
function isCreateOnceRule(rule: Rule): rule is Rule & CreateOnceRule {
	return "createOnce" in rule;
}

/** Bind a test runner's hooks to RuleTester's statics.
 *
 * Call once at module scope of a test file (or setup file) before running suites.
 *
 * @param {TestRunner} runner - The ambient runner's hooks.
 */
export function wireRuleTester(runner: TestRunner): void {
	RuleTester.describe = runner.describe;
	RuleTester.it = runner.it;
	if (runner.itOnly !== undefined) {
		RuleTester.itOnly = runner.itOnly;
	}
}

/** A tester instance bound to the wired runner.
 *
 * @returns {RuleTester} A fresh RuleTester.
 */
export function createTester(): RuleTester {
	return new RuleTester();
}

/**
 * Adapt a `createOnce` rule for Oxlint's RuleTester.
 *
 * RuleTester drives rules through their ESLint-compatible `create` method and
 * does not understand `before`/`after` lifecycle hooks. Like native Oxlint, the
 * adapter invokes `createOnce` once and reuses its visitors for every linted
 * file, so state a rule forgets to reset in `before` leaks between test cases
 * exactly as it would leak between files in a real run. It also honours the
 * skip contract (`before` returning `false` skips the file), and chains the
 * rule's own `Program:exit` visitor with the after hook instead of clobbering it.
 *
 * @param {CreateOnceRule | Rule} rule - The createOnce-style rule to adapt. A
 * rule already in ESLint-style passes through untouched.
 * @returns {Rule} An ESLint-compatible rule with an identical per-file lifecycle.
 */
export function testableRule(rule: Rule): Rule {
	if (!isCreateOnceRule(rule)) return rule;
	type Context = Parameters<CreateOnceRule["createOnce"]>[0];
	let currentContext!: Context;
	const sharedContext = new Proxy(
		{},
		{
			get(_target, key) {
				// SAFETY: the proxy stands in for the per-file context, so every key
				// read is a key of that context.
				const value: unknown = currentContext[key as keyof Context];
				return value instanceof Function ? value.bind(currentContext) : value;
			},
		},
	);
	let hooks: ReturnType<CreateOnceRule["createOnce"]> | undefined;
	const adapter = {
		meta: rule.meta,
		create(context: Context) {
			currentContext = context;
			// SAFETY: the proxy forwards every read to the current file's context.
			hooks ??= rule.createOnce(sharedContext as Context);
			const { after, before, ...visitor } = hooks;
			// SAFETY: visitor fragments come from this plugin's own createOnce
			// contract; method keys map one-to-one onto the tester's call shape.
			const visitors = visitor as VisitorRecord;
			const skip = before !== undefined && before() === false;
			if (skip) return {};
			const previousExit = visitors["Program:exit"];
			return {
				...visitors,
				"Program:exit"(...callArguments: never[]) {
					previousExit?.(...callArguments);
					after?.();
				},
			};
		},
	};
	// SAFETY: the adapter reproduces Rule's meta/create surface; its visitors
	// are the createOnce fragments the tester already consumes.
	return adapter as Rule;
}

type VisitorRecord = Record<string, ((...args: never[]) => unknown) | undefined>;
