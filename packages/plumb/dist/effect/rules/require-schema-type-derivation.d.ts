/**
 * Single source of truth: once a Schema exists, it is the canonical shape.
 * A hand-written twin type drifts from it silently: derive the static side
 * with `Schema.Type<typeof x>` so identical data can only have one declared
 * form.
 */
export declare const requireSchemaTypeDerivationRule: import("@oxlint/plugins").Rule;
