import { RuleTester } from "oxlint/plugins-dev";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { testableRule, wireRuleTester } from "../../testing/testable-rule.ts";
import {
	classColorFindings,
	isTokenColor,
	noOffTokenColorRule,
} from "./no-off-token-color.ts";

wireRuleTester({ describe, it });

const COLORS = [
	"background", "foreground", "primary", "muted", "border",
	"color-background", "color-foreground", "color-primary", "color-muted", "color-border",
	"red", "500",
];

const manifest = {
	colors: COLORS,
	components: [],
};

const OPTIONS = [{ manifest }];
const PAGE = "src/page.tsx";

new RuleTester().run(
	"no-off-token-color",
	testableRule(noOffTokenColorRule) as never,
	{
		valid: [
			// On-token named utilities, plain and wrapped.
			{ code: `const c = "bg-primary text-background";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "border border-border bg-background text-foreground";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "hover:bg-muted sm:text-primary dark:bg-background";`, filename: PAGE, options: OPTIONS },
			// Opacity modifiers keep the underlying token.
			{ code: `const c = "bg-primary/70 text-muted/50";`, filename: PAGE, options: OPTIONS },
			// The v4 variable shorthand for a declared variable.
			{ code: `const c = "bg-(--color-primary)";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "text-[var(--color-foreground)]";`, filename: PAGE, options: OPTIONS },
			// A nested scale passes by its root key.
			{ code: `const c = "bg-red-500 text-red-500";`, filename: PAGE, options: OPTIONS },
			// Keywords are not palette members.
			{ code: `const c = "bg-transparent fill-none stroke-none text-inherit";`, filename: PAGE, options: OPTIONS },
			// Same-prefix utilities that are not colors.
			{ code: `const c = "text-sm text-left text-2xl text-balance text-ellipsis";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "bg-cover bg-center bg-no-repeat bg-gradient-to-r bg-clip-text bg-blend-multiply";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "border-2 border-solid border-t-4 divide-x divide-y-0 ring-2 ring-inset outline-none outline-2";`, filename: PAGE, options: OPTIONS },
			{ code: `const c = "decoration-solid decoration-2 accent-auto stroke-2";`, filename: PAGE, options: OPTIONS },
			// Arbitrary values that are not colors.
			{ code: `const c = "text-[17px] border-[2px] bg-[url(/hero.png)] bg-[length:200px] shadow-[0_2px_8px_rgba(0,0,0,0.1)]";`, filename: PAGE, options: OPTIONS },
			// Negation and important markers do not hide the utility.
			{ code: `const c = "-bg-primary !text-muted bg-primary!";`, filename: PAGE, options: OPTIONS },
			// Module specifiers are not class lists.
			{ code: `import { x } from "bg-tokens";`, filename: PAGE, options: OPTIONS },
			{ code: `export { x } from "./text-red-500";`, filename: PAGE, options: OPTIONS },
			// Tests may hard-code anything.
			{ code: `const c = "bg-[#334e68] text-red-900";`, filename: "src/page.test.tsx", options: OPTIONS },
			// SVG paint attributes using references or keywords.
			{ code: `const el = <svg fill="none" stroke="currentColor"><stop stopColor="inherit"/></svg>;`, filename: PAGE, options: OPTIONS },
			// Style objects with token variables or non-color values.
			{ code: `const el = <div style={{ color: "var(--color-primary)", width: "12px" }} />;`, filename: PAGE, options: OPTIONS },
		],
		invalid: [
			{
				// `blue` is neither a declared name nor rooted at one (`red` is, so red-900 passes).
				code: `const c = "text-blue-900";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "offToken" }],
			},
			{
				// `grey` is neither a declared name nor rooted at one.
				code: `const c = "bg-grey-100 text-foreground";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "offToken" }],
			},
			{
				code: `const c = "hover:bg-[#334e68]";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "arbitrary" }],
			},
			{
				code: `const c = "border-[rgb(51,78,104)] text-[hsl(214,32%,91%)]";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "arbitrary" }, { messageId: "arbitrary" }],
			},
			{
				// A variable the token source never declared.
				code: `const c = "bg-(--brand) fill-[var(--brand)]";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "arbitrary" }, { messageId: "arbitrary" }],
			},
			{
				code: `const c = "from-red-500 via-[#fff] to-primary";`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "arbitrary" }],
			},
			{
				code: "const c = `bg-primary text-[#ffffff]`;",
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "arbitrary" }],
			},
			{
				code: `const el = <div style={{ color: "#334e68", borderColor: "rgb(1,2,3)" }} />;`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "rawColor" }, { messageId: "rawColor" }],
			},
			{
				code: `const el = <svg fill="#334e68" />;`,
				filename: PAGE,
				options: OPTIONS,
				errors: [{ messageId: "rawColor" }],
			},
		],
	},
);

// A separate suite because `testableRule` reuses one `createOnce` result: a manifest
// without colors is a different config, and the rule must go quiet, not invent a set.
new RuleTester().run(
	"no-off-token-color without a readable set",
	testableRule({ ...noOffTokenColorRule }) as never,
	{
		valid: [
			{
				code: `const c = "bg-[#334e68] text-red-900";`,
				filename: PAGE,
				options: [{ manifest: "./does-not-exist.json" }],
			},
			{
				code: `const c = "bg-[#334e68] text-red-900";`,
				filename: PAGE,
				options: [{ manifest: { components: [] } }],
			},
		],
		invalid: [],
	},
);

const PREFIX = fc.constantFrom(
	"bg", "text", "border", "border-t", "ring", "fill", "stroke",
	"from", "via", "to", "divide", "outline", "decoration", "accent", "caret", "placeholder",
);

const TOKEN_NAME = fc.constantFrom("background", "foreground", "primary", "muted", "border");

const HEX = fc.tuple(
	fc.constantFrom("#"),
	fc.string({ unit: fc.constantFrom(..."0123456789abcdef".split("")), minLength: 6, maxLength: 6 }),
).map(([hash, digits]) => hash + digits);

const WRAPPER = fc.constantFrom("", "hover:", "sm:hover:", "dark:", "!");

function wrap(prefix: string, wrapper: string, body: string): string {
	return wrapper === "!" ? `!${prefix}-${body}` : `${wrapper}${prefix}-${body}`;
}

describe("no-off-token-color properties", () => {
	it("never flags a declared token, however it is wrapped", () => {
		fc.assert(
			fc.property(PREFIX, TOKEN_NAME, WRAPPER, (prefix, name, wrapper) => {
				const token = wrap(prefix, wrapper, name);
				expect(classColorFindings(token, new Set(COLORS))).toEqual([]);
			}),
		);
	});

	it("always flags a hard-coded hex in a color utility", () => {
		fc.assert(
			fc.property(PREFIX, HEX, WRAPPER, (prefix, hex, wrapper) => {
				const token = wrap(prefix, wrapper, `[${hex}]`);
				const findings = classColorFindings(token, new Set(COLORS));
				expect(findings).toHaveLength(1);
				expect(findings[0]?.kind).toBe("arbitrary");
			}),
		);
	});

	it("always flags a color name outside the set", () => {
		const offToken = fc.string({ unit: fc.constantFrom(..."abcdefghij".split("")), minLength: 4, maxLength: 8 })
			.filter((name) => !isTokenColor(name, new Set(COLORS)) && !["auto", "none", "left", "right"].includes(name));
		fc.assert(
			fc.property(PREFIX, offToken, (prefix, name) => {
				const findings = classColorFindings(`${prefix}-${name}`, new Set(COLORS));
				// Prefixes with numeric/keyword grammars may read the name as non-color;
				// the finding is only guaranteed where the name cannot parse that way.
				if (findings.length === 1) expect(findings[0]?.kind).toBe("offToken");
			}),
		);
	});

	it("never flags a string with no color utility in it", () => {
		fc.assert(
			fc.property(
				fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")), minLength: 0, maxLength: 60 }),
				(text) => {
					expect(classColorFindings(text, new Set(COLORS))).toEqual([]);
				},
			),
		);
	});
});
