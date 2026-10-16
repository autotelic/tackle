/**
 * A rule that lives in the repository rather than in the tool.
 *
 * Note the imports. This file reaches the package the way a stranger would -- by
 * name, at a documented entry point -- and not the way the first version did,
 * through three relative paths into `src/`. The difference is what makes a rule
 * an opinion rather than a fork: `@autotelic/joggle/plugin` is supported, and anything not
 * re-exported there is not.
 */
import { Effect, defineRule, outcome, type Rule } from "@autotelic/joggle/plugin"

export const rules: ReadonlyArray<Rule> = [
  defineRule({
    id: "example/one-thing",
    severity: "warn",
    description: "An opinion that ships with the repository, not with joggle.",
    judged: false,
    run: () => Effect.succeed(outcome([], ["example/one-thing ran from a plugin"])),
  }),
]
