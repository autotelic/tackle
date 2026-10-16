/**
 * Disallow SQL queries built from template literal interpolation. String
 * interpolation in SQL is an injection vector: attacker-controlled values
 * become query structure. Use parameterized queries or a query builder
 * instead so values never become syntax.
 */
export declare const noSqlStringInterpolationRule: import("@oxlint/plugins").Rule;
