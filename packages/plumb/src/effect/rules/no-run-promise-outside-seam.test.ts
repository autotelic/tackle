import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { isSeamFile, noRunPromiseOutsideSeamRule } from "./no-run-promise-outside-seam.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-run-promise-outside-seam",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noRunPromiseOutsideSeamRule) as never,
	{
		valid: [
			{ code: `const mapped = Effect.map(effect, f);`, filename: "src/handler.ts" },
			{
				code: `Effect.runPromise(effect);`,
				filename: "src/cli.ts",
				options: [{ seams: ["src/cli.ts"] }],
			},
			{
				code: `Effect.runPromise(effect);`,
				filename: "/repo/packages/app/src/cli.ts",
				options: [{ seams: ["src/cli.ts"] }],
			},
			{
				code: `import * as E from "effect"; E.runPromise(effect);`,
				filename: "app/server.ts",
				options: [{ seams: ["app/server.ts"] }],
			},
			{ code: `Effect.runPromise(effect);`, filename: "src/handler.test.ts" },
			{
				code: `import * as Runtime from "effect/Runtime"; Runtime.runPromise(effect);`,
				filename: "src/handler.ts",
			},
			{
				code: `import { runPromise as go } from "effect/Runtime"; go(effect);`,
				filename: "src/handler.ts",
			},
			{ code: `runPromise(effect);`, filename: "src/handler.ts" },
		],
		invalid: [
			{
				code: `Effect.runPromise(effect);`,
				filename: "src/handler.ts",
				errors: [{ messageId: "outsideSeam" }],
			},
			{
				code: `Effect.runPromise(effect);`,
				filename: "src/service.ts",
				options: [{ seams: ["src/cli.ts"] }],
				errors: [{ messageId: "outsideSeam" }],
			},
			{
				code: `import * as E from "effect"; E.runPromise(effect);`,
				filename: "src/handler.ts",
				errors: [{ messageId: "outsideSeam" }],
			},
			{
				code: `import { runPromise } from "effect/Effect"; runPromise(effect);`,
				filename: "src/handler.ts",
				errors: [{ messageId: "outsideSeam" }],
			},
			{
				code: `import { runPromise as go } from "effect"; go(effect);`,
				filename: "src/handler.ts",
				errors: [{ messageId: "outsideSeam" }],
			},
			{
				code: `import * as Effect from "effect/Effect"; Effect.runPromise(effect);`,
				filename: "src/handler.ts",
				errors: [{ messageId: "outsideSeam" }],
			},
		],
	},
);

// Property: a seam exempts the file it names and nothing else, whatever absolute prefix the
// file carries. The exemption is the one decision a mistake here would make silent -- an
// over-broad match would exempt the tree and the rule would report zero forever.
describe("no-run-promise-outside-seam property", () => {
	it("matches a configured seam on a segment boundary only", () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom("repo", "packages", "app", "src"), { maxLength: 4 }),
				fc.constantFrom("src/cli.ts", "app/shared/effect/http.ts", "src/main.ts"),
				(segments, seam) => {
					const prefixed = segments.length === 0 ? seam : segments.join("/") + "/" + seam;
					expect(isSeamFile({ filename: prefixed, seams: [seam] })).toBe(true);

					const lookalike = prefixed.replace(/\.ts$/u, "x.ts");
					expect(isSeamFile({ filename: lookalike, seams: [seam] })).toBe(false);
				},
			),
		);
	});

	it("never exempts a file for an empty seam", () => {
		expect(isSeamFile({ filename: "src/handler.ts", seams: [""] })).toBe(false);
	});
});
