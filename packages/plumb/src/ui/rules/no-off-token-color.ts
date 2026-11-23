import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { firstOptionRecord } from "../../shared/rule-options.ts";

import {
	decodeUiManifest,
	manifestAt,
	type UiManifest,
} from "../manifest.ts";

/*
 * A design system survives on a closed set of colors. The set only works if every
 * color in the UI names a member of it: one `text-[#334E68]` or `bg-red-500` is a
 * color the palette never reviewed, and a hundred of them is a palette that exists
 * in a config file but not in the product.
 *
 * Cutlist already extracts the set — theme keys and color-ish CSS variables — into
 * the manifest's top-level `colors` array. This rule is the lookup half: every
 * color-utility class, arbitrary color value, SVG paint attribute and inline style
 * color in a file must resolve to a name in that array. The rule never decides what
 * the palette should be; it reports the places the code stopped agreeing with it.
 *
 * The rule fails open. A missing manifest, or one with no `colors`, means no
 * findings: a lint rule inventing a palette from a file it could not read is worse
 * than one that is briefly quiet. `cutlist build --check` is the gate that makes
 * the manifest current.
 *
 * One deliberate blind spot: when the set holds a scale's root (`red`, from a
 * config's nested keys) any shade of it (`red-999`) passes, because the manifest's
 * flat key list cannot distinguish a real shade from an invented one. Shade
 * completeness belongs to cutlist's token extraction, not to a lookup.
 */

const RULE_ID = "plumb-ui/no-off-token-color";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const CACHE = new Map<string, UiManifest | undefined>();

/** The verdict one class token receives, when it is a color utility at all. */
export interface ColorFinding {
	readonly token: string;
	readonly kind: "offToken" | "arbitrary";
	readonly name?: string;
}

/** One color-utility match, handed to the named and arbitrary branches. */
interface UtilityMatch {
	readonly token: string;
	readonly prefix: string;
	readonly value: string;
	readonly colors: ReadonlySet<string>;
}

/** A prefix and its candidate name, for the non-color grammar exclusions. */
interface PrefixName {
	readonly prefix: string;
	readonly name: string;
}

/** Color names that are keywords, not palette members. */
const COLOR_KEYWORDS: ReadonlySet<string> = new Set(["transparent", "current", "inherit"]);

/*
 * Utility prefixes that accept a color, longest first where they overlap
 * (`ring-offset` before `ring`, `border-t` before `border`). `shadow` is absent on
 * purpose: its arbitrary values are elevations, and elevation is a different system.
 */
const COLOR_UTILITY =
	/^(bg|text|border-[trblxyse]|border|ring-offset|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret|placeholder)-(.+)$/u;

/** `text-` values that are sizes, alignment, wrapping or overflow, not colors. */
const TEXT_NON_COLOR: ReadonlySet<string> = new Set([
	"xs", "sm", "base", "lg", "xl",
	"left", "center", "right", "justify", "start", "end",
	"wrap", "nowrap", "balance", "pretty",
	"ellipsis", "clip",
]);

/** `bg-` values that are attachment, size, position, repeat or origin, not colors. */
const BG_NON_COLOR: ReadonlySet<string> = new Set([
	"fixed", "local", "scroll",
	"cover", "contain", "auto", "none",
	"bottom", "center", "left", "left-bottom", "left-top",
	"right", "right-bottom", "right-top", "top",
	"repeat", "no-repeat", "repeat-x", "repeat-y", "repeat-round", "repeat-space",
	"border", "padding", "content",
]);

/** `bg-` name prefixes that are blend modes, clip modes or gradients, not colors. */
const BG_NON_COLOR_PREFIXES: ReadonlyArray<string> = [
	"blend-", "clip-", "gradient-", "linear-", "radial-", "conic-",
];

/** Border and outline styles, and table border models. */
const BORDER_STYLES: ReadonlySet<string> = new Set([
	"solid", "dashed", "dotted", "double", "hidden", "none", "collapse", "separate",
]);

/** Text-decoration lines and thickness keywords. */
const DECORATION_NON_COLOR: ReadonlySet<string> = new Set([
	"solid", "double", "dotted", "dashed", "wavy", "auto", "from-font",
]);

/** A numeric utility value: `2`, `0.5`, `17px`. */
const NUMERIC = /^\d+(?:\.\d+)?[a-z%]*$/iu;

/** A raw color literal: `#abc`, `#aabbccdd`, or a color function. */
const RAW_COLOR =
	/^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\()/iu;

/** Arbitrary content that is an image, gradient or type-hinted non-color, not a color. */
const NON_COLOR_ARBITRARY =
	/^(?:url\(|image\(|(?:linear|radial|conic|repeating)[-(]|(?:length|position|image|url):)/iu;

/** Style object keys whose string values are colors. */
const COLOR_STYLE_PROP =
	/^(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left|Block|Inline)?Color|fill|stroke|outlineColor|caretColor|textDecorationColor|columnRuleColor)$/u;

/** SVG paint attributes whose values should be `currentColor` or a token, never a literal. */
const SVG_PAINT_ATTRS: ReadonlySet<string> = new Set([
	"fill", "stroke", "stopColor", "floodColor", "lightingColor",
]);

/**
 * Whether a value is a plain object.
 *
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode a configured manifest, by inline value or by path.
 *
 * Mirrors `no-deprecated-parts`: a rule test passes the manifest inline, a config passes
 * a path, and both decode through the same reader. A path is read once and remembered.
 *
 * @param {unknown} value - The rule option: an inline manifest or a manifest path.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it cannot be read.
 */
function manifestFrom(value: unknown): UiManifest | undefined {
	if (isRecord(value) && Array.isArray(value.components)) return decodeUiManifest(value);
	if (typeof value !== "string") return undefined;
	if (!CACHE.has(value)) CACHE.set(value, manifestAt(value));
	return CACHE.get(value);
}

/**
 * Whether a color name is inside the declared set.
 *
 * The set mixes theme keys (`primary`) with variable names (`color-primary`), because
 * both layers are legal token sources and cutlist records both. A lookup therefore tries
 * the name, its `color-`-prefixed twin, and its first dash segment — the last because a
 * nested scale (`red: {500: …}`) arrives as the root key `red`, and any of its shades
 * should pass (see the file header for the blind spot that creates).
 *
 * @param {string} name - The color name from a utility, without prefix or modifiers.
 * @param {ReadonlySet<string>} colors - The manifest's declared colors.
 * @returns {boolean} True when the name belongs to the set.
 */
export function isTokenColor(name: string, colors: ReadonlySet<string>): boolean {
	if (COLOR_KEYWORDS.has(name)) return true;
	if (colors.has(name) || colors.has(`color-${name}`)) return true;
	const root = name.split("-")[0];
	return root !== undefined && colors.has(root);
}

/**
 * Whether a CSS variable name is inside the declared set.
 *
 * @param {string} variable - The variable name, with or without the leading `--`.
 * @param {ReadonlySet<string>} colors - The manifest's declared colors.
 * @returns {boolean} True when the variable is a declared color token.
 */
function isTokenVariable(variable: string, colors: ReadonlySet<string>): boolean {
	const name = variable.replace(/^--/u, "");
	if (colors.has(name)) return true;
	return name.startsWith("color-") && colors.has(name.slice("color-".length));
}

/**
 * Split a class token into its variant segments at bracket depth zero.
 *
 * Variants are `:`-separated, but arbitrary values can contain `:` inside brackets
 * (`bg-[url:http://…]`), so a naive split misreads them. Only the last segment is the
 * utility; everything before it is `hover:`, `sm:`, `dark:` and friends.
 *
 * @param {string} token - One whitespace-separated class token.
 * @returns {string} The utility segment, without variants.
 */
function utilityOf(token: string): string {
	let depth = 0;
	let last = 0;
	for (let index = 0; index < token.length; index += 1) {
		const char = token[index];
		if (char === "[" || char === "(") depth += 1;
		else if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
		else if (char === ":" && depth === 0) last = index + 1;
	}
	return token.slice(last);
}

/**
 * The finding for an arbitrary color value, or `undefined` when it is not a color.
 *
 * An arbitrary value is `prefix-[value]` or the v4 variable shorthand `prefix-(--var)`.
 * Not every arbitrary value is a color: `text-[17px]` is a font size and `bg-[url(…)]`
 * is an image. Only color-shaped content — a hex, a color function, or a variable that
 * is not a declared token — is a finding; anything else is another system's business.
 * A bare word in a color slot (`text-[red]`) is a named CSS color and a finding, except
 * under `bg-`, where it can be a position or repeat keyword, which is not this rule's find.
 *
 * @param {UtilityMatch} match - The token, its prefix, the bracketed value, and the set.
 * @returns {ColorFinding | undefined} The finding, or `undefined` when the value is clean.
 */
function arbitraryFinding({ token, prefix, value, colors }: UtilityMatch): ColorFinding | undefined {
	const shorthand = value.match(/^\((--[\w-]+)\)$/u);
	if (shorthand !== null) {
		const variable = shorthand[1];
		return variable !== undefined && isTokenVariable(variable, colors)
			? undefined
			: { token, kind: "arbitrary" };
	}
	if (!value.startsWith("[") || !value.endsWith("]")) return undefined;
	const inner = value.slice(1, -1).trim();
	if (inner === "" || NON_COLOR_ARBITRARY.test(inner) || NUMERIC.test(inner)) return undefined;
	if (RAW_COLOR.test(inner) || inner.startsWith("theme(")) return { token, kind: "arbitrary" };
	const variable = inner.match(/^var\((--[\w-]+)/u);
	if (variable !== null) {
		const name = variable[1];
		return name !== undefined && isTokenVariable(name, colors)
			? undefined
			: { token, kind: "arbitrary" };
	}
	const hinted = inner.match(/^color:\s*(.+)$/u);
	if (hinted !== null) {
		const rest = hinted[1];
		return rest !== undefined && RAW_COLOR.test(rest) ? { token, kind: "arbitrary" } : undefined;
	}
	if (prefix !== "bg" && /^[a-zA-Z][\w-]*$/u.test(inner) && !COLOR_KEYWORDS.has(inner)) {
		return { token, kind: "arbitrary" };
	}
	return undefined;
}

/**
 * Whether a named (non-arbitrary) value is a known non-color for its prefix.
 *
 * Utility grammars share prefixes: `text-sm` is a size, `border-2` a width, `ring-inset`
 * a side, and `divide-x`/`divide-y` (with their widths) the axis grammar. Without these
 * exclusions the rule would read half of Tailwind as color names.
 *
 * @param {PrefixName} candidate - The matched utility prefix and the value after its dash.
 * @returns {boolean} True when the value is not a color for this prefix.
 */
function isNonColorFor({ prefix, name }: PrefixName): boolean {
	if (prefix === "text") return TEXT_NON_COLOR.has(name) || /^\d+xl$/u.test(name);
	if (prefix === "bg") {
		return BG_NON_COLOR.has(name) || BG_NON_COLOR_PREFIXES.some((p) => name.startsWith(p));
	}
	if (prefix === "border" || prefix.startsWith("border-")) {
		return BORDER_STYLES.has(name) || NUMERIC.test(name);
	}
	if (prefix === "ring") return name === "inset" || NUMERIC.test(name);
	if (prefix === "ring-offset") return NUMERIC.test(name);
	if (prefix === "divide") {
		return /^[xy](?:-|$)/u.test(name) || name === "reverse" || BORDER_STYLES.has(name) || NUMERIC.test(name);
	}
	if (prefix === "outline") return BORDER_STYLES.has(name) || NUMERIC.test(name);
	if (prefix === "decoration") return DECORATION_NON_COLOR.has(name) || NUMERIC.test(name);
	if (prefix === "accent") return name === "auto";
	if (prefix === "fill" || prefix === "stroke") return name === "none" || NUMERIC.test(name);
	return false;
}

/**
 * The findings in one class-bearing string.
 *
 * The string is split on whitespace; each token is stripped of variants, negation and
 * the important marker, then tested against the color-utility grammar. Tokens that are
 * not color utilities — the vast majority in any string — yield nothing, which is what
 * makes it safe to run this over every string literal in a file rather than guessing
 * which expressions hold class lists.
 *
 * @param {string} text - The string to inspect (a class list, or any string at all).
 * @param {ReadonlySet<string>} colors - The manifest's declared colors.
 * @returns {Array<ColorFinding>} One finding per distinct offending token, in order.
 */
export function classColorFindings(
	text: string,
	colors: ReadonlySet<string>,
): Array<ColorFinding> {
	const findings: Array<ColorFinding> = [];
	const seen = new Set<string>();
	for (const raw of text.split(/\s+/u)) {
		if (raw === "") continue;
		const utility = utilityOf(raw).replace(/^-+/u, "").replace(/^!+/u, "").replace(/!+$/u, "");
		const match = COLOR_UTILITY.exec(utility);
		if (match === null) continue;
		const prefix = match[1];
		const value = match[2];
		if (prefix === undefined || value === undefined) continue;
		const finding = value.startsWith("[") || value.startsWith("(")
			? arbitraryFinding({ token: raw, prefix, value, colors })
			: namedFinding({ token: raw, prefix, value, colors });
		if (finding !== undefined && !seen.has(finding.token)) {
			seen.add(finding.token);
			findings.push(finding);
		}
	}
	return findings;
}

/**
 * The finding for a named color utility value, or `undefined` when it is clean.
 *
 * @param {UtilityMatch} match - The token, its prefix, the name, and the set.
 * @returns {ColorFinding | undefined} The finding, or `undefined` when the name is on-token.
 */
function namedFinding({ token, prefix, value, colors }: UtilityMatch): ColorFinding | undefined {
	const name = value.split("/")[0];
	if (name === undefined || isNonColorFor({ prefix, name })) return undefined;
	return isTokenColor(name, colors) ? undefined : { token, kind: "offToken", name };
}

/**
 * The name of a JSX attribute, or `undefined` for spread and namespaced forms.
 *
 * @param {ESTree.JSXAttribute} attribute - The attribute node.
 * @returns {string | undefined} The attribute's local name.
 */
function jsxAttributeName(attribute: ESTree.JSXAttribute): string | undefined {
	return attribute.name.type === "JSXIdentifier" ? attribute.name.name : undefined;
}

/**
 * The name of a style object key, or `undefined` for computed keys.
 *
 * @param {ESTree.ObjectProperty} property - The object property.
 * @returns {string | undefined} The key's name.
 */
function styleKeyOf(property: ESTree.ObjectProperty): string | undefined {
	if (property.computed) return undefined;
	if (property.key.type === "Identifier") return property.key.name;
	if (property.key.type === "Literal") return String(property.key.value);
	return undefined;
}

export const noOffTokenColorRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Every color in the UI must name a member of the catalog's declared color set; hard-coded values and off-token names are reported.",
		},
		messages: {
			offToken:
				"`{{token}}` uses color `{{name}}`, which is not one of the catalog's declared colors; pick a shade from the token set (see tokens.md).",
			arbitrary:
				"`{{token}}` hard-codes a color value instead of naming a catalog token; choose a declared shade, or add this one to the token source.",
			rawColor:
				"`{{prop}}` hard-codes color `{{value}}`; use a token class so the color stays inside the declared set.",
		},
		schema: [
			{
				type: "object",
				properties: {
					manifest: {
						anyOf: [{ type: "string" }, { type: "object" }],
					},
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ manifest: "tools/ui-catalog/plumb-ui.config.json" }],
	},
	createOnce(context) {
		/*
		 * Oxlint populates `context.options` per file, not per run: at createOnce time it
		 * is null. The manifest is therefore resolved in `before()`, where the options are
		 * real; `manifestFrom` caches by path, so a per-file lookup is a per-run read.
		 */
		let colors: ReadonlySet<string> = new Set();
		let active = false;

		/** Module specifiers are string literals too; a path is never a class list. */
		const moduleSources = new WeakSet<object>();

		/**
		 * Report every off-token or hard-coded color in one class-bearing string.
		 *
		 * @param {string} text - The string's text.
		 * @param {ESTree.Node} node - The node to attach reports to.
		 */
		function checkClassText(text: string, node: ESTree.Node): void {
			for (const finding of classColorFindings(text, colors)) {
				if (finding.kind === "offToken") {
					context.report({
						node,
						messageId: "offToken",
						data: { token: finding.token, name: finding.name ?? "" },
					});
				} else {
					context.report({
						node,
						messageId: "arbitrary",
						data: { token: finding.token },
					});
				}
			}
		}

		return {
			before() {
				if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) {
					active = false;
					return false;
				}
				const option = firstOptionRecord(context.options);
				const manifest = manifestFrom(option.manifest);
				if (manifest === undefined || manifest.colors.length === 0) {
					active = false;
					return false;
				}
				colors = new Set(manifest.colors);
				active = true;
			},
			ImportDeclaration(node) {
				moduleSources.add(node.source);
			},
			ExportNamedDeclaration(node) {
				if (node.source !== null) moduleSources.add(node.source);
			},
			ExportAllDeclaration(node) {
				moduleSources.add(node.source);
			},
			Literal(node) {
				if (!active || typeof node.value !== "string" || moduleSources.has(node)) return;
				checkClassText(node.value, node);
			},
			TemplateLiteral(node) {
				if (!active) return;
				for (const quasi of node.quasis) {
					if (quasi.value.cooked !== null) checkClassText(quasi.value.cooked, quasi);
				}
			},
			JSXAttribute(node) {
				if (!active) return;
				const name = jsxAttributeName(node);
				if (name === undefined) return;
				if (
					SVG_PAINT_ATTRS.has(name) &&
					node.value?.type === "Literal" &&
					typeof node.value.value === "string" &&
					RAW_COLOR.test(node.value.value)
				) {
					context.report({
						node: node.value,
						messageId: "rawColor",
						data: { prop: name, value: node.value.value },
					});
					return;
				}
				if (
					name !== "style" ||
					node.value?.type !== "JSXExpressionContainer" ||
					node.value.expression.type !== "ObjectExpression"
				) {
					return;
				}
				for (const property of node.value.expression.properties) {
					if (property.type !== "Property") continue;
					const key = styleKeyOf(property);
					if (
						key === undefined ||
						!COLOR_STYLE_PROP.test(key) ||
						property.value.type !== "Literal" ||
						typeof property.value.value !== "string" ||
						!RAW_COLOR.test(property.value.value)
					) {
						continue;
					}
					context.report({
						node: property.value,
						messageId: "rawColor",
						data: { prop: key, value: property.value.value },
					});
				}
			},
		};
	},
});

export { RULE_ID };
