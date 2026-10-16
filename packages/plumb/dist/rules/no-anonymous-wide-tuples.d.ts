/**
 * Dense representations are sliceable on any axis because their parts are
 * named. Past two elements, positional tuples hide which position carries
 * which fact: swap-prone, unreadable at call sites, and impossible to
 * slice meaningfully. Give wide tuples a named shape.
 */
export declare const noAnonymousWideTuplesRule: import("@oxlint/plugins").Rule;
