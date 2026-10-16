import { defineConfig } from "oxlint"

/*
 * The workspace's own lint config — empty of rules on purpose.
 *
 * plumb lands here (see MIGRATION.md item 6): `jsPlugins` gains `@autotelic/plumb` and
 * `rules` spreads `plumbRecommendedRules`. Until then this file exists so the wiring point
 * is in one place, and so the `config` field in `jig.config.json` resolves.
 *
 * For whoever adds the first rule: a root config's `ignorePatterns` does NOT stop oxlint
 * resolving `examples/self/.oxlintrc.json`, which names a plugin this workspace has not
 * moved in yet — the build fails before a single file is read. Neither does `.oxlintignore`.
 * Only the command line works (`--ignore-pattern 'examples/**'`, as `pnpm lint` does), so the
 * exclusion lives there and not here. Both other forms were tried.
 */
export default defineConfig({})
