/**
 * Bounded touch points: adding a variant should be caught by the compiler at
 * every place that must change. A `default` arm on a tag switch, even a
 * throwing one, silences that check, so unhandled variants slip through
 * silently or via hand-rolled fallbacks instead of failing type-check.
 */
export declare const requireExhaustiveTagSwitchRule: import("@oxlint/plugins").Rule;
