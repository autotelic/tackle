/**
 * Whether a file belongs to the declared values path.
 *
 * A declared prefix matches the file itself or anything below it. With no
 * option, a directory SEGMENT carries the name, so `src/domain/money.ts` and
 * `packages/domain/src/hours.ts` are both values.
 *
 * @param {string} filename - The file being linted.
 * @param {readonly unknown[] | undefined} options - The rule's raw options.
 * @returns {boolean} True when the file is inside the values stratum.
 */
export declare function inValuesPath(filename: string, options: readonly unknown[] | undefined): boolean;
