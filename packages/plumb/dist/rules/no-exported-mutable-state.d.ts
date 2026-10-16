/**
 * No blessed surface area: a value that escapes module scope mutably lets
 * every invariant its constructor established be broken from outside. Module
 * state must be immutable bindings over immutable structures; anything that
 * varies belongs in parameters, state objects or Effect services.
 */
export declare const noExportedMutableStateRule: import("@oxlint/plugins").Rule;
