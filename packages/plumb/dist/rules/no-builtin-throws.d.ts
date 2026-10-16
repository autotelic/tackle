/**
 * Flag throwing generic built-in errors at call sites that should instead throw
 * a project-defined tagged error carrying its evidence structurally (e.g.
 * Data.TaggedError with operation/value/domain fields plus a rendered message).
 */
export declare const noBuiltinThrowsRule: import("@oxlint/plugins").Rule;
