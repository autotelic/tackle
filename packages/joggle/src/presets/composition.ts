import { pageNeedsComposition } from "../rules/page-needs-composition.ts"
import { bundleRules } from "../rules/bundle-conformance.ts"
import type { JoggleConfig } from "../config.ts"
import type { PlannedRule, Rule } from "../rule.ts"

/**
 * The composition pattern, as an opinion rather than a default.
 *
 * These five rules came out of a starter repository's own documentation. They are
 * somebody's architecture -- a provider owning `{ state, actions, meta }`, blocks
 * exported by dot notation, one file per block -- and running them on a codebase
 * that never agreed to that is the entropy machine with a command-line flag.
 *
 * So they ship as a preset. A repository opts in:
 *
 *   { "presets": ["@autotelic/joggle/presets/composition"] }
 *
 * and gets the rules AND their severities. It can then override any of it per
 * rule, because a preset sets defaults rather than taking over.
 *
 * Every rule is judged now: the bundle checks find the departure from the
 * pattern, and Jev decides whether it is a defect. The page rule triggers on
 * evidence -- local state and inline markup -- rather than on a file being under
 * `routes/`.
 */
export const rules: ReadonlyArray<Rule | PlannedRule> = [...bundleRules, pageNeedsComposition]

export const config: JoggleConfig = {
  rules: {
    "joggle/bundle-dot-notation": "warn",
    "joggle/bundle-tripartite-value": "warn",
    "joggle/bundle-one-file-per-block": "warn",
    "joggle/bundle-context-hook": "warn",
    "joggle/page-needs-composition": "warn",
  },
}
