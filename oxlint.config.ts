import { plumbEffectRecommendedRules, plumbRecommendedRules } from "@autotelic/plumb/configs"

/*
 * The workspace's own lint config — where plumb runs on the code that ships plumb.
 *
 * plumb lands here (MIGRATION.md item 6, FOREMAN.md §11 Phase A): `jsPlugins` gains the
 * `plumb` and `plumb-effect` plugins and `rules` spreads their recommended sets, so `jig`'s
 * `plumb` engine runs real rules instead of bare oxlint wearing plumb's name.
 *
 * The rules are the recommended sets at `error` (FOREMAN §5, rung 4). They began at `warn`
 * with every finding frozen in `.jig-baseline.json` by identity; Phase B drove that baseline
 * from 149 identities to empty, then flipped the rules. The file-scoped `overrides` below are
 * the places where the code and the rules disagree, each with the reason written down — they
 * are where the last findings went, and their length is the metric to watch, not hide.
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

/** Every `plumb-effect` rule at `off` — for code that is not an Effect application. */
const effectOff: Record<string, "off"> = Object.fromEntries(
  Object.keys(plumbEffectRecommendedRules).map((rule) => [rule, "off"]),
)

/*
 * The boundary carve-out — `combine`, not a suppression.
 *
 * `protocol`, `cutlist`, and `jig-cli` are seam code: they decode raw JSON and raw AST into
 * typed values. The rules below all say "do not widen, do not assert, return Option, parse
 * at the edge" — and at a decode boundary that is exactly the job. `packages/joggle` made
 * this same decision for its own crossers, with the reasoning written beside it: "the decode
 * bridge: raw AST nodes and raw plugin modules in, typed values out ... they own the crossing
 * between raw AST/config payloads and typed rule logic". `plumb`'s own config carves out its
 * bridge module with the same sentence. This is that decision, applied to the code it also
 * describes, rather than re-argued per file.
 *
 * The files are listed rather than globbed so the carve-out cannot grow silently: adding a
 * boundary module is a visible line in this list. §5's rule holds — a growing exception list
 * is a finding about the vocabulary, not the code — so the list's length is itself the
 * metric to watch.
 */
const BOUNDARY_FILES = [
  "packages/protocol/src/decode.ts",
  "packages/protocol/src/config.ts",
  "packages/protocol/src/compat.ts",
  "packages/protocol/src/catalog.ts",
  "packages/protocol/src/lexicon.ts",
  "packages/protocol/src/fixture-support.ts",
  "packages/protocol/src/report.ts",
  "packages/protocol/src/doc.ts",
  "packages/protocol/src/baseline.ts",
  "packages/cutlist/src/crawl.ts",
  "packages/cutlist/src/check.ts",
  "packages/jig-cli/src/engines.ts",
  "packages/jig-cli/src/opencode.ts",
  "packages/jig-cli/src/baseline.ts",
  "packages/jig-cli/extensions/jig.ts",
  // The conformance tests hold raw fixture bytes against a schema: the same crossing, in a
  // test. The cast is the test's subject, not an accident.
  "packages/protocol/src/conformance.test.ts",
  "packages/protocol/src/compat.test.ts",
  "packages/protocol/src/projections.test.ts",
  // The host's half of the same conformance: it reads the spec's fixture bytes and compares
  // its own projection to them. Same crossing, same reason.
  "packages/jig-cli/src/projections.test.ts",
]

const BOUNDARY_RULES = {
  "plumb/no-unknown-parameters": "off",
  "plumb/no-unknown-returns": "off",
  "plumb/no-runtime-typeof": "off",
  "plumb/no-reinterpret-cast": "off",
  "plumb/no-unsafe-dictionary-type": "off",
  "plumb/require-safety-comment-for-type-assertion": "off",
  "plumb-effect/guarded-op-must-return-option": "off",
  // A parse failure at a boundary is the ordinary case, and these are synchronous parsers
  // with no Effect context to route the failure through. The `Effect.try` remedy needs an
  // effect; a pure function has none.
  "plumb-effect/no-try-catch": "off",
} as const

/*
 * `no-conditional-empty-object-spread` — the same disagreement `joggle` recorded.
 *
 * Under `exactOptionalPropertyTypes` an ABSENT key and a key present-and-`undefined` are
 * different shapes, and `...(x === undefined ? {} : { x })` is how the absent one is built.
 * The rule's alternatives set the key to `undefined`, which is the other shape. The sites are
 * config merges, report builders, and projection helpers; the answer is the same at every one.
 */
const CONDITIONAL_SPREAD_FILES = [
  "packages/protocol/src/config.ts",
  "packages/protocol/src/report.ts",
  "packages/protocol/src/catalog.ts",
  "packages/protocol/src/doc.ts",
  "packages/protocol/src/projections.test.ts",
  "packages/jig-cli/src/projections.test.ts",
  "packages/jig-cli/src/engines.ts",
  "packages/jig-cli/src/opencode.ts",
  "packages/jig-cli/extensions/jig.ts",
]

export default {
  ignorePatterns: [
    "node_modules",
    "examples/**",
    "packages/plumb/**",
    "packages/joggle/**",
    // The foreman is the ratchet's engine, not a specimen: a dependency-free Node program
    // (node:sqlite + node:child_process) that is deliberately not an Effect app, so most of
    // the rulebook's reasons do not apply to it. It is held to the rules in a later round;
    // scoping it here keeps the seam packages' carve-out from growing to cover tooling.
    "tools/**",
  ],
  jsPlugins: [
    { name: "plumb", specifier: "@autotelic/plumb" },
    { name: "plumb-effect", specifier: "@autotelic/plumb/effect" },
  ],
  rules: {
    ...plumbRecommendedRules,
    ...plumbEffectRecommendedRules,
    "plumb-effect/require-schema-type-derivation": "off",
  },
  overrides: [
    { files: BOUNDARY_FILES, rules: BOUNDARY_RULES },
    {
      files: CONDITIONAL_SPREAD_FILES,
      rules: { "plumb/no-conditional-empty-object-spread": "off" },
    },
    {
      // Reasoning belongs where the decision is made. joggle recorded exactly this for its
      // own tree: plumb wants the note in JSDoc, but an inline comment sits beside the line
      // it explains, and moving it onto a signature forty lines above separates the two.
      files: ["packages/*/src/**", "packages/jig-cli/extensions/**"],
      rules: { "plumb/no-stray-inline-comments": "off" },
    },
    {
      // `shape` is the domain word in the vocabulary: a declaration's shape is its token
      // sequence with every identifier blanked. The rule reads "shape" as
      // structure-rather-than-ownership, which is meaningless here — the shape is of nothing
      // in particular, so there is no owner to name. joggle's reason, the same words.
      files: [
        "packages/protocol/src/catalog.ts",
        "packages/protocol/src/decode.ts",
        "packages/cutlist/src/tokens.ts",
        "packages/cutlist/src/render/tokens.ts",
      ],
      rules: { "plumb/no-shape-in-symbol-names": "off" },
    },
    {
      // A package's `index.ts` IS the aggregate surface: one name a consumer imports, and one
      // place to add the next export. A barrel hides ownership in an application; here the
      // aggregation is the point. joggle excepted its `plugin.ts` for the same reason.
      files: ["packages/*/src/index.ts"],
      rules: { "plumb/no-barrel-export-star": "off" },
    },
    {
      // `let` counters local to a module nothing exports — a script's pass/fail tallies, a
      // walk's accumulator. joggle's `workspace.ts` exception is the same shape.
      files: ["packages/*/scripts/**", "packages/cutlist/src/tokens.ts"],
      rules: { "plumb/no-exported-mutable-state": "off" },
    },
    {
      // Standalone Node scripts, not part of the Effect application. joggle states the
      // principle: plumb-effect is consumer-opt-in upstream because plumb itself is not an
      // Effect app, and these scripts are not either — they run under plain `node`.
      files: ["packages/*/scripts/**"],
      rules: effectOff,
    },
    {
      // Lookup tables indexed by a runtime string. joggle's reason, verbatim: the annotation
      // is what gives them an index signature, and `satisfies` would keep the literal's keys
      // and then reject the dynamic lookup the table exists for. The widening is the type.
      files: [
        "packages/jig-cli/src/engines.ts",
        "packages/protocol/src/lexicon.ts",
        "packages/protocol/src/fixture-support.ts",
        "packages/protocol/src/report.ts",
      ],
      rules: { "plumb/no-known-value-widening": "off" },
    },
    {
      // `protocol` is the zero-dependency leaf: it cannot import Effect's `Predicate`, so the
      // rule's remedy is inexpressible here. Recorded as a vocabulary gap, not a suppression.
      files: ["packages/protocol/src/fixture-support.ts"],
      rules: { "plumb-effect/prefer-effect-predicate-over-boolean-function": "off" },
    },
    {
      // Module-scope lookups whose absence is the ordinary answer: a specifier that does not
      // resolve, a component with no owner. joggle's words: "absence is the ordinary answer
      // ... and each miss is already recorded as a fact". Wrapping each hop in Option would
      // move the same branch to every call site without adding a distinction the domain has.
      files: ["packages/cutlist/src/catalog.ts", "packages/cutlist/src/owners.ts"],
      rules: { "plumb-effect/guarded-op-must-return-option": "off" },
    },
    {
      // `Date.now()` measures a wall-clock duration for the report's `durationMs`. It is not
      // part of a finding's identity, of the baseline, or of any canonical byte, so it cannot
      // make the ratchet non-reproducible — which is the harm the rule exists to prevent.
      files: ["packages/jig-cli/src/engines.ts", "packages/jig-cli/src/run.ts"],
      rules: { "plumb/no-nondeterministic-core": "off" },
    },
  ],
}
