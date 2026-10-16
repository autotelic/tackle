/**
 * Disallow using nullish coalescing (`??`) with a literal default on a
 * member expression of an external input object. In partial updates
 * (PATCH/PUT), a field might be intentionally absent; `?? false` conflates
 * "absent" with "explicitly false", so you can't distinguish "don't change
 * this field" from "set it to false".
 *
 * This pattern re-invent's Effect's Schema: it manually detects absence where
 * `Schema.optional` / `Schema.nullable` would distinguish absent from falsy
 * with full type safety. The schema also centralizes the rule so it can't
 * drift between the API and the UI.
 */
export declare const noNullishDefaultOnPartialInputRule: import("@oxlint/plugins").Rule;
