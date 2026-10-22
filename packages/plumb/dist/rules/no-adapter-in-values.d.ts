/** Whether an import is a cost-driven dependency the values stratum may not hold.
 *
 * @param {string} specifier - The import specifier.
 * @returns {boolean} True when it is a query builder, a driver or an adapter path.
 */
export declare function isAdapter(specifier: string): boolean;
/**
 * The values stratum depends on nothing internal. A `Money` that can import the
 * query builder is not a value: it is a row with a reassuring name, and the
 * next author will put a `where` clause in it.
 */
export declare const noAdapterInValuesRule: import("@oxlint/plugins").Rule;
