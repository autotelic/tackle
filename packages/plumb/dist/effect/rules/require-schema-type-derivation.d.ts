/**
 * Single source of truth: once a Schema exists, it is the canonical shape.
 * A hand-written twin type drifts from it silently: derive the static side
 * with `Schema.Type<typeof x>` so identical data can only have one declared form.
 *
 * Per-file state, reset in `before`: the maps describe one file's declarations, so a
 * run never reports an interface in `b.ts` against a schema declared in `a.ts` -- at
 * line 1, citing a name the file does not contain -- or answers differently depending
 * on the order files were visited. An interface with a heritage clause is skipped for
 * the same reason: `interface X extends Schema.Type<typeof XSchema>` is the fix this
 * rule asks for, not the twin it reports.
 */
export declare const requireSchemaTypeDerivationRule: import("@oxlint/plugins").Rule;
