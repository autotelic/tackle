declare const RULE_ID = "plumb-ui/no-off-token-color";
/** The verdict one class token receives, when it is a color utility at all. */
export interface ColorFinding {
    readonly token: string;
    readonly kind: "offToken" | "arbitrary";
    readonly name?: string;
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
export declare function isTokenColor(name: string, colors: ReadonlySet<string>): boolean;
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
export declare function classColorFindings(text: string, colors: ReadonlySet<string>): Array<ColorFinding>;
export declare const noOffTokenColorRule: import("@oxlint/plugins").Rule;
export { RULE_ID };
