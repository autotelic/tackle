import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts";
import { noSingleUsePrivateFunctionsRule, isTrivialForwarder } from "./no-single-use-private-functions.ts";
import { identifiers } from "./test-utils.ts";
import type { ESTree } from "@oxlint/plugins";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-single-use-private-functions",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noSingleUsePrivateFunctionsRule) as never,
	{
		valid: [
			{ code: "function double(x: number) { return x * 2; } const y = double(2);", filename: "a.ts" },
			{ code: "const add = (a: number, b: number) => realAdd(a, b + 1); const r = add(1, 2);", filename: "a.ts" },
			{ code: "const t = () => g; const u = t();", filename: "a.ts" },
			{ code: "const add = (a: number, b: number) => realAdd(a, b); const x = add(1, 2); const y = add(3, 4);", filename: "a.ts" },
		],
		invalid: [
			{ code: "const add = (a: number, b: number) => realAdd(a, b); const r = add(1, 2);", filename: "a.ts", errors: [{ messageId: "singleUseFunction" }] },
			{ code: "function add(a: number, b: number) { return realAdd(a, b); } const r = add(1, 2);", filename: "a.ts", errors: [{ messageId: "singleUseFunction" }] },
		],
	},
);

// Property: a function is a trivial forwarder iff its body is a single call that
// forwards every parameter verbatim (no extra args, no literals, no other logic).
describe("no-single-use-private-functions property", () => {
	it("isTrivialForwarder is true iff the body forwards every parameter verbatim", () => {
		fc.assert(
			fc.property(
				fc.tuple(
					fc.uniqueArray(identifiers, { minLength: 1, maxLength: 4 }),
					identifiers,
					fc.constantFrom("ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"),
					fc.integer({ min: 0, max: 6 }),
				),
				([params, extra, kind, variant]) => {
					const id = (name: string): ESTree.Node => ({ type: "Identifier", name } as unknown as ESTree.Node);
					const p = params.map((name) => id(name));
					const call = (args: Array<ESTree.Node>): ESTree.Node => ({
						type: "CallExpression",
						callee: { type: "Identifier", name: "target" },
						arguments: args,
						optional: false,
					} as unknown as ESTree.Node);
					const ret = (c: ESTree.Node): ESTree.Node => ({ type: "ReturnStatement", argument: c } as unknown as ESTree.Node);
					const exprStmt = (): ESTree.Node => ({ type: "ExpressionStatement", expression: { type: "Identifier", name: "x" } } as unknown as ESTree.Node);
					const block = (stmts: Array<ESTree.Node>): ESTree.Node => ({ type: "BlockStatement", body: stmts } as unknown as ESTree.Node);
					const arrowOrBlock = (c: ESTree.Node): ESTree.Node => (kind === "ArrowFunctionExpression" ? c : block([ret(c)]));
					const forward = (): ESTree.Node => call(p);
					const forwardExtra = (): ESTree.Node => call([...p, id(extra)]);
					const forwardLiteral = (): ESTree.Node => {
						const args = [...p];
						args[args.length - 1] = { type: "Literal", value: 1 } as unknown as ESTree.Node;
						return call(args);
					};
					let body: ESTree.Node = exprStmt();
					let trivial = false;
					switch (variant) {
						case 0: body = arrowOrBlock(forward()); trivial = true; break;
						case 1: body = arrowOrBlock(forwardExtra()); trivial = false; break;
						case 2: body = arrowOrBlock(forwardLiteral()); trivial = false; break;
						case 3: body = block([ret(forward())]); trivial = true; break;
						case 4: body = block([ret(forwardExtra())]); trivial = false; break;
						case 5: body = block([exprStmt(), exprStmt()]); trivial = false; break;
						case 6: body = block([exprStmt()]); trivial = false; break;
					}
					const fn = { type: kind, params: p, body } as unknown as ESTree.Node;
					expect(isTrivialForwarder(fn)).toBe(trivial);
				},
			),
		);
	});
});
