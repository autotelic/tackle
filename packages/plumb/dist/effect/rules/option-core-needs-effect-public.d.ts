/**
 * Every exported `*Option` guarded core must have a converted public twin in the
 * same module, so Option-shaped internals cannot silently become the public API.
 */
export declare const optionCoreNeedsEffectPublicRule: import("@oxlint/plugins").Rule;
