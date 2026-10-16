/**
 * Whether a context value type's member keys form the tripartite
 * state/actions/meta contract.
 *
 * @param {ReadonlyArray<string>} members - The declared member key names.
 * @returns {boolean} True when `state`, `actions`, and `meta` are all present.
 */
export declare function isTripartiteContextValue(members: ReadonlyArray<string>): boolean;
/**
 * A React context's value must be shaped as `{ state, actions, meta }`: state is
 * the data, actions are the functions that change it, and meta holds
 * non-reactive configuration. This is the explicit I/O boundary of the
 * component family - the same "perfect function" contract as the composition
 * pattern. A context that omits one of the three leaks an implicit, unnamed
 * channel that consumers cannot reason about.
 */
export declare const requireTripartiteContextRule: import("@oxlint/plugins").Rule;
