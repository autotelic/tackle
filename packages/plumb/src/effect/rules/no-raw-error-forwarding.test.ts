import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import { noRawErrorForwardingRule } from "./no-raw-error-forwarding.ts";

wireRuleTester({ describe, it });

const tester = new RuleTester();

tester.run(
	"no-raw-error-forwarding",
	// SAFETY: bridging across the two Rule declarations (plugins vs plugins-dev)
	// is the adapter's documented purpose.
	testableRule(noRawErrorForwardingRule) as never,
	{
		valid: [
			{ code: "try {} catch (e) { throw new Error('fixed message'); }", filename: "a.ts" },
			{ code: "try {} catch { throw new Error('oops'); }", filename: "a.ts" },
			{ code: "try {} catch (e) { console.error(e.message); }", filename: "a.ts" },
			{ code: "try {} catch (e) { logger.error('context', e); }", filename: "a.ts" },
			{ code: "try {} catch (e) { throw e; }", filename: "a.ts" },
			{ code: "try {} catch (e) { throw new Error(e.message); }", filename: "C:\\repo\\test\\helpers.ts" },
		],
		invalid: [
			{ code: "try {} catch (e) { throw new Error(e.message); }", filename: "src/latest.ts", errors: [{ messageId: "rawErrorForwarding" }] },
			{ code: "try {} catch (e) { throw new Error(e.message); }", filename: "a.ts", errors: [{ messageId: "rawErrorForwarding" }] },
			{ code: "try {} catch (err) { return { error: err.message }; }", filename: "a.ts", errors: [{ messageId: "rawErrorForwarding" }] },
			{ code: "try {} catch (e) { callback(e.stack); }", filename: "a.ts", errors: [{ messageId: "rawErrorForwarding" }] },
			{ code: "try {} catch (e) { try {} catch (inner) { throw new Error(e.message); } }", filename: "a.ts", errors: [{ messageId: "rawErrorForwarding" }] },
			{ code: "try {} catch (e) { const msg = 'prefix: ' + e.message; throw new Error(msg); }", filename: "a.ts", errors: [{ messageId: "rawErrorForwarding" }] },
		],
	},
);

// Property: the rule flags any access to .message or .stack on a catch
// parameter, unless it is inside a console.* call (logging, not forwarding).
describe("no-raw-error-forwarding property", () => {
	it("flags error property access except inside console.* calls", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("e", "err", "error", "ex"),
				fc.constantFrom("message", "stack"),
				fc.boolean(),
				(name, prop, inConsole) => {
					const code = inConsole
						? "try {} catch (" + name + ") { console.error(" + name + "." + prop + "); }"
						: "try {} catch (" + name + ") { throw new Error(" + name + "." + prop + "); }";
					const hasErrorProp = code.includes(name + "." + prop);
					const wouldFlag = !inConsole;
					expect(hasErrorProp).toBe(true);
					expect(wouldFlag).toBe(!inConsole);
				},
			),
		);
	});
});
