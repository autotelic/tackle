/**
 * Whether a custom context hook that reads context must be reported for
 * lacking a guard against a missing Provider.
 *
 * @param {{ isHook: boolean; callsUseContext: boolean; guarded: boolean }} input - The hook's shape facts.
 * @returns {boolean} True when the hook needs a guard but has none.
 */
export declare function requiresContextGuard(input: {
    isHook: boolean;
    callsUseContext: boolean;
    guarded: boolean;
}): boolean;
/**
 * A custom hook that reads context with `useContext` must throw when the
 * Provider is missing, rather than returning `undefined` and pushing a
 * null-check onto every consumer. Returning a possibly-undefined context is the
 * same hidden-nullable defect the rest of the library forbids.
 */
export declare const requireGuardedContextHookRule: import("@oxlint/plugins").Rule;
