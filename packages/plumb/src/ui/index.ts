import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDeprecatedPartsRule } from "./rules/no-deprecated-parts.ts";

/**
 * Rules that read the catalog's lint manifest.
 *
 * These are separate from `plumb-react` because they need a second input — the generated
 * manifest — and a repository without a catalog should not enable them. A rule here is a
 * lookup, never a second analysis: cutlist already decided which part is deprecated and
 * what replaces it.
 */
const plumbUiPlugin = eslintCompatPlugin({
	meta: { name: "plumb-ui" },
	rules: {
		"no-deprecated-parts": noDeprecatedPartsRule,
	},
});

export default plumbUiPlugin;
export { noDeprecatedPartsRule };
