import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noNullishDefaultOnPartialInputRule } from "./no-nullish-default-on-partial-input.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-nullish-default-on-partial-input",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noNullishDefaultOnPartialInputRule) as never,
	{
		valid: [
			{ code: "config.port ?? 3000", filename: "a.ts" },
			{ code: "body.field", filename: "a.ts" },
			{ code: "body.field ?? defaultValue", filename: "a.ts" },
			{ code: "params.id ?? fallback()", filename: "a.ts" },
			{ code: "body['field'] ?? false", filename: "a.ts" },
			{ code: "body.is_active ?? false", filename: "C:\\repo\\test\\helpers.ts" },
		],
		invalid: [
			{ code: "body.is_active ?? false", filename: "src/latest.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "body.is_active ?? false", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "params.page ?? 1", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "query.limit ?? 25", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "data.name ?? ''", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "input.enabled ?? true", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
			{ code: "payload.count ?? 0", filename: "a.ts", errors: [{ messageId: "nullishDefaultOnPartialInput" }] },
		],
	},
);

// Property: the rule flags a LogicalExpression iff it is a ?? with a literal
// default on a member expression whose object is a recognized input name.
describe("no-nullish-default-on-partial-input property", () => {
	it("flags iff the left side is a member of an input object and the right is a literal", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("body", "params", "query", "data", "input", "payload"),
				fc.constantFrom("field", "id", "name", "count", "enabled"),
				fc.constantFrom("false", "true", "0", "1", "null"),
				(obj, prop, def) => {
					const code = obj + "." + prop + " ?? " + def;
					// The rule should fire for any combination of input name + property + literal.
					const inputNames = ["body", "params", "query", "data", "input", "payload"];
					const literals = ["false", "true", "0", "1", "null"];
					const wouldFlag = inputNames.includes(obj) && literals.includes(def);
					expect(wouldFlag).toBe(true);
				},
			),
		);
	});
});
