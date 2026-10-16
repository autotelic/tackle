/**
 * Whether a component family (a Provider plus a useXxx hook sharing one family
 * name) must carry a dot-notation aggregate export. The useXxx hook is the
 * family's consumption API and is exported separately by convention, so
 * `aggregateOk` only asks whether the aggregate (export const Family = {
 * Provider, ... }) exists and carries its Provider.
 *
 * @param {{ providerFamily: string | null; hookFamily: string; singleFamily: boolean; aggregateOk: boolean }} input - The family's export facts.
 * @returns {boolean} True when an aggregate is required but absent.
 */
export declare function familyRequiresAggregate(input: {
    providerFamily: string | null;
    hookFamily: string;
    singleFamily: boolean;
    aggregateOk: boolean;
}): boolean;
/**
 * A component family (a Provider plus a `useXxx` consumer hook) must be exported
 * through a single dot-notation aggregate (`export const Family = { Provider, ... }`)
 * so consumers compose `Family.Provider` / `Family.Header` and the blocks are
 * discoverable. Bare re-exports of `Provider`/`useXxx` without the aggregate
 * hide the family boundary.
 *
 * Uses createOnce; per-file state is reset in before() (which oxlint calls per
 * file), so a family seen in one file cannot leak into another.
 */
export declare const requireDotNotationExportsRule: import("@oxlint/plugins").Rule;
