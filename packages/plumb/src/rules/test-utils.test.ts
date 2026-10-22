import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { collectReports, identifiers, makeTester, memberExpression, wrap } from "./test-utils.ts";

// Drive a trivial probe through the wired tester: makeTester binds RuleTester
// to vitest's hooks and returns a fresh instance.
makeTester().run(
	"probe",
	// SAFETY: the empty visitor set is the minimal rule surface the tester runs.
	{ create: () => ({}) } as never,
	{ valid: [{ code: `const x = 1;`, filename: "a.ts" }], invalid: [] },
);

describe("test-utils", () => {
	it("wrap registers a rule under the requested name", () => {
		const wrapped = wrap("probe", { create: () => ({}) });
		expect(wrapped.create).toBeTypeOf("function");
	});

	it("collectReports gathers reports from a visitor probe", () => {
		const rule = {
			create: (context: { report: (diagnostic: { messageId: string }) => void }) => ({
				Identifier: () => context.report({ messageId: "hit" }),
			}),
		};
		// SAFETY: the object above is the minimal ESLint-style rule shape
		// collectReports wraps and probes.
		const reports = collectReports(rule as never, "Identifier", { type: "Identifier" });
		expect(reports).toEqual([{ messageId: "hit" }]);
	});

	it("memberExpression builds a member node on the fixed base", () => {
		expect(memberExpression(false, "parent").type).toBe("MemberExpression");
	});

	it("makeTester returns a RuleTester bound to the ambient runner", () => {
		expect(makeTester()).toBeInstanceOf(RuleTester);
	});

	it("identifiers excludes declaration keywords", () => {
		fc.assert(
			fc.property(identifiers, (name) => {
				expect(["const", "let", "var", "function", "class"]).not.toContain(name);
			}),
		);
	});
});
