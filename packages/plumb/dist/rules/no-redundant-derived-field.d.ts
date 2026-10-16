/**
 * One fact, one place: a type that stores data *and* a field derivable from
 * that data keeps two sources of truth that drift apart independently. Counts
 * belong to read sites; ordering belongs in the structure itself.
 */
export declare const noRedundantDerivedFieldRule: import("@oxlint/plugins").Rule;
