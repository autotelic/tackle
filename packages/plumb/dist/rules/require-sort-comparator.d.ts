/**
 * Canonical form requires intentional order. The default sort coerces
 * elements to strings and compares lexicographically, so the "natural"
 * ordering silently depends on element encoding; an explicit comparator
 * makes the canonical order deliberate and reviewable.
 */
export declare const requireSortComparatorRule: import("@oxlint/plugins").Rule;
