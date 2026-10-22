/**
 * Whether a member expression's root names transport input rather than a row.
 *
 * @param {string} name - The root identifier.
 * @returns {boolean} True when the root is a request, a query or a body.
 */
export declare function isTransportRoot(name: string): boolean;
/**
 * A number read out of a row is text from the driver until something decodes
 * it. `Number(row.amount)` is a second implementation of the domain's schema,
 * with its own failure: `NaN` instead of a decode error.
 */
export declare const noRowCoercionRule: import("@oxlint/plugins").Rule;
