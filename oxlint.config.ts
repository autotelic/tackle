import { defineConfig } from "oxlint"

/*
 * The workspace's own lint config — empty of rules on purpose.
 *
 * plumb lands here (see MIGRATION.md item 6): `jsPlugins` gains `@autotelic/plumb` and
 * `rules` spreads `plumbRecommendedRules`. Until then this file exists so the wiring point
 * is in one place, and so the `config` field in `jig.config.json` resolves.
 *
 * For whoever adds the first rule: `plumb` is in this workspace, but its rules are not wired
 * in here yet, and `pnpm lint` cannot reach three directories at once — `examples/self`, whose
 * `.oxlintrc.json` names `@autotelic/plumb/ui` (on the branch the move did not take) and the
 * external `@shadcn/lint`; and `packages/plumb` and `packages/joggle`, which each carry their
 * own config and may not nest under this one (`options.typeAware` is root-only). A root
 * config's `ignorePatterns` does NOT stop oxlint building a directory's config — the run fails
 * before a single file is read — and neither does `.oxlintignore`. Only the command line
 * works, so the exclusions live in `pnpm lint` and not here. All other forms were tried.
 */
export default defineConfig({})
