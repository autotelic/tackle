/**
 * Guarded operations must surface absence as ABSENCE_TYPE, not a null/undefined
 * union or a crash. The id keeps its historical "option" name so consumer configs
 * do not break.
 */
export declare const guardedOpMustReturnOptionRule: import("@oxlint/plugins").Rule;
