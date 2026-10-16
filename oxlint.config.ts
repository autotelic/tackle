import { plumbEffectRecommendedRules, plumbRecommendedRules } from "@autotelic/plumb/configs"

/*
 * The workspace's own lint config — where plumb runs on the code that ships plumb.
 *
 * plumb lands here (MIGRATION.md item 6, FOREMAN.md §11 Phase A): `jsPlugins` gains the
 * `plumb` and `plumb-effect` plugins and `rules` spreads their recommended sets, so `jig`'s
 * `plumb` engine runs real rules instead of bare oxlint wearing plumb's name.
 *
 * The rules sit at `warn`, not the recommended `error`, for one round. A single error-enable
 * puts ~450 findings across `protocol`, `cutlist`, and `jig-cli` behind a plain `pnpm lint`
 * that has no baseline to ratchet against — the "error over a growing baseline" FOREMAN §5
 * warns against. Phase B moves each rule to `error` under the ≤50-findings entry bar; until
 * then `pnpm jig check` freezes the same findings in `.jig-baseline.json` by identity, so
 * they are visible and cannot be re-reported.
 *
 * `plumb-react` is absent on purpose: nothing here renders.
 *
 * `plumb-effect/require-schema-type-derivation` is off, matching
 * `packages/joggle/oxlint.config.ts`: it collects schema names and interfaces at Program:exit
 * without reading the `extends` clause, so it reports every Schema-derived interface as
 * hand-rolled, and its createOnce cross-file state makes the same tree report 33/39/40
 * findings run to run. A rule that cannot hold a reproducible baseline cannot join a ratchet.
 *
 * The `ignorePatterns` mirror the flags `pnpm lint` and `jig`'s plumb engine pass on the
 * command line. They are documentation here; the command line is what actually works —
 * oxlint builds a directory's nested config before it applies any ignore.
 */

/** Every rule a recommended set ships, held at `warn` until Phase B ratchets it. */
const atWarn = (rules: Readonly<Record<string, unknown>>): Record<string, "warn"> =>
  Object.fromEntries(Object.keys(rules).map((rule) => [rule, "warn"]))

export default {
  ignorePatterns: ["node_modules", "examples/**", "packages/plumb/**", "packages/joggle/**"],
  jsPlugins: [
    { name: "plumb", specifier: "@autotelic/plumb" },
    { name: "plumb-effect", specifier: "@autotelic/plumb/effect" },
  ],
  rules: {
    ...atWarn(plumbRecommendedRules),
    ...atWarn(plumbEffectRecommendedRules),
    "plumb-effect/require-schema-type-derivation": "off",
  },
}
