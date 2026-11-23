import { noDeprecatedPartsRule } from "./rules/no-deprecated-parts.ts";
import { noOffTokenColorRule } from "./rules/no-off-token-color.ts";
/**
 * Rules that read the catalog's lint manifest.
 *
 * These are separate from `plumb-react` because they need a second input — the generated
 * manifest — and a repository without a catalog should not enable them. A rule here is a
 * lookup, never a second analysis: cutlist already decided which part is deprecated and
 * what replaces it.
 */
declare const plumbUiPlugin: import("@oxlint/plugins").Plugin;
export default plumbUiPlugin;
export { noDeprecatedPartsRule, noOffTokenColorRule };
