/**
 * Ban the case-insensitive substring "shape" in the names a package CHOOSES.
 *
 * The rule used to fire on every Identifier, which made it flag a member read
 * (`unit.shape`) and an import of someone else's export. Neither is a name this
 * package chose: renaming them is not its decision, and the only way to satisfy
 * the rule was to spell the read `unit["shape"]`, which is worse code. It stays
 * in scope at declaration sites, which is where a name is introduced.
 */
export declare const noForbiddenTermInSymbolNamesRule: import("@oxlint/plugins").Rule;
