/**
 * We default to property-based testing: a test suite without fast-check only
 * pins examples. Escape hatch is an explicit inline disable with a reason.
 *
 * The visitor resets its state in `before()`: `createOnce` state spans the whole
 * run, so without the reset a file that imports fast-check marks every later file
 * as having one, and the same tree reports a suite or does not depending on the
 * order files are visited.
 */
export declare const preferPropertyTestsRule: import("@oxlint/plugins").Rule;
