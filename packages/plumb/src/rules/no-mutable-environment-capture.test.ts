import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noMutableEnvironmentCaptureRule } from "./no-mutable-environment-capture.ts";
import { identifiers } from "./test-utils.ts";
import type { ESTree } from "@oxlint/plugins";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-mutable-environment-capture",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noMutableEnvironmentCaptureRule) as never,
	{
		valid: [
			{ code: "let helper = () => 5; function useHelper() { return helper(); }", filename: "a.ts" },
			{ code: "const config = loadConfig(); function getKind() { return config.kind; }", filename: "a.ts" },
			{ code: "let count = 0; function add(a: number, b: number) { return a + b; }", filename: "a.ts" },
			{ code: "let count = 0; function f() { const x: typeof count = 1; return x; }", filename: "a.ts" },
			{ code: "let seed = 0; function derive(localSeed: number) { return localSeed * 2; }", filename: "a.ts" },
		],
		invalid: [
			{ code: "let count = 0; function getCount() { return count; }", filename: "a.ts", errors: [{ messageId: "mutableModuleState" }] },
			{ code: "let prng = makePrng(); function nextRandom() { return prng.next(); }", filename: "a.ts", errors: [{ messageId: "mutableModuleState" }] },
			{ code: "let count = 0; function outer() { const inner = () => count; return inner; }", filename: "a.ts", errors: [{ messageId: "mutableModuleState" }] },
			{ code: "var total = 0; function bump() { total++; }", filename: "a.ts", errors: [{ messageId: "mutableModuleState" }] },
		],
	},
);

interface SynthRef {
	resolved: { name: string };
	identifier: { type: string; name: string };
	isWrite: () => boolean;
	isRead: () => boolean;
}
interface SynthScope {
	references: Array<SynthRef>;
}
interface ProbeContext {
	filename: string;
	sourceCode: { getScope: () => SynthScope; getAncestors: () => Array<ESTree.Node> };
	report: (d: { messageId: string }) => void;
}
interface ProbeVisitor {
	Program: (node: ESTree.Program) => void;
	FunctionDeclaration: (node: ESTree.Node) => void;
}

// Property: a function is reported once per reference that resolves to a
// non-helper module let/var binding, regardless of read or write.
describe("no-mutable-environment-capture property", () => {
	it("reports each reference to non-helper module state, in any position", () => {
		fc.assert(
			fc.property(
				fc.tuple(
					fc
						.array(fc.record({ name: identifiers, isHelper: fc.boolean() }), { minLength: 0, maxLength: 4 })
						.map((bindings) => {
							const seen = new Set<string>();
							return bindings.filter((b) => {
								if (seen.has(b.name)) return false;
								seen.add(b.name);
								return true;
							});
						}),
					fc.array(fc.record({ name: identifiers, isWrite: fc.boolean() }), { minLength: 0, maxLength: 5 }),
				),
				([bindings, references]) => {
					const stateNames = new Set(bindings.filter((b) => !b.isHelper).map((b) => b.name));
					const expected = references.filter((r) => stateNames.has(r.name)).length;

					const varDecl = {
						type: "VariableDeclaration",
						kind: "let",
						declarations: bindings.map((b) => ({
							type: "VariableDeclarator",
							id: { type: "Identifier", name: b.name },
							init: b.isHelper
								? ({ type: "ArrowFunctionExpression", params: [], body: { type: "BlockStatement", body: [] }, async: false, expression: false } as unknown as ESTree.Node)
								: ({ type: "Literal", value: 0 } as unknown as ESTree.Node),
						})),
					};
					const funcNode = {
						type: "FunctionDeclaration",
						id: null,
						params: [],
						body: { type: "BlockStatement", body: [] },
					} as unknown as ESTree.Node;
					const scope: SynthScope = {
						references: references.map((r) => ({
							resolved: { name: r.name },
							identifier: { type: "Identifier", name: r.name },
							isWrite: () => r.isWrite,
							isRead: () => !r.isWrite,
						})),
					};
					const program = { type: "Program", body: [varDecl, funcNode] } as unknown as ESTree.Program;

					let reports = 0;
					const rule = testableRule(noMutableEnvironmentCaptureRule) as unknown as {
						create: (ctx: ProbeContext) => ProbeVisitor;
					};
					const visitor = rule.create({
						filename: "a.ts",
						sourceCode: { getScope: () => scope, getAncestors: () => [] },
						report: () => {
							reports += 1;
						},
					});
					visitor.Program(program);
					visitor.FunctionDeclaration(funcNode);
					expect(reports).toBe(expected);
				},
			),
		);
	});
});
