/**
 * The plumb opinions that apply to THIS repository.
 *
 * plumb asks whether one file is well formed; joggle asks whether two things are
 * the same and whether a thing fits here. This file is the first half running on
 * the second half's source, which is the honest test of both: the rules that need
 * one file to answer should be answerable here, and anything that needs two files
 * belongs to joggle.
 *
 * The ruleset is generic plus effect. joggle is a Node application built on
 * Effect -- gen, Schema, Layer, Ref, Context.Service -- and renders nothing, so
 * plumb-react stays out. plumb-meta is for people writing oxlint rules, which
 * joggle does not.
 *
 * `plumb-effect` is consumer-opt-in upstream because plumb itself is not an
 * Effect application. This repository is, so the whole set is on.
 *
 * The second Effect rulebook is `@effect/tsgo`'s, which is the Effect language
 * service's own diagnostics exposed as type-aware Oxlint rules. Every rule it
 * ships is enabled below, from all four of its categories, so the codebase is
 * held to the upstream opinion as well as plumb's. Correctness and anti-pattern
 * rules are errors; the Effect-native and style rules are warnings, matching the
 * tool's own taxonomy. `pnpm lint:update` folds the existing findings into the
 * same baseline ratchet, which is what makes adopting a rulebook this size
 * possible at all.
 */

import { antipattern, correctness, effectNative, style } from "@effect/tsgo/oxlint-presets"

const GENERIC = [
  "no-anonymous-wide-tuples",
  "no-barrel-export-star",
  "no-boolean-field-signals",
  "no-builtin-throws",
  "no-chained-type-assertions",
  "no-conditional-empty-object-spread",
  "no-duplicated-literal-union",
  "no-exported-mutable-state",
  "no-generic-export-names",
  "no-impossible-branch-throw",
  "no-known-value-widening",
  "no-module-mocking",
  "no-multiple-function-params",
  "no-mutable-environment-capture",
  "no-nondeterministic-core",
  "no-object-parameters",
  "no-optional-function-parameters",
  "no-product-of-state-booleans",
  "no-redundant-derived-field",
  "no-reflect-apply",
  "no-reflect-get",
  "no-reinterpret-cast",
  "no-runtime-typeof",
  "no-sentinel-comparison-union",
  "no-shape-in-symbol-names",
  "no-single-use-private-functions",
  "no-sql-string-interpolation",
  "no-stacked-jsdoc-blocks",
  "no-stray-inline-comments",
  "no-swappable-primitive-params",
  "no-tag-ladder-assertions",
  "no-transposed-field-reads",
  "no-unit-return-validators",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-unsafe-dictionary-type",
  "no-widen-then-assert",
  "prefer-payload-brand",
  "require-canonical-stringify-for-identity",
  "require-deprecated-tag-for-legacy-comments",
  "require-exhaustive-tag-switch",
  "require-fc-block-predicate",
  "require-jsdoc-on-exported",
  "require-published-order",
  "require-safety-comment-for-type-assertion",
  "require-sort-comparator",
] as const;

const EFFECT = [
  "guarded-op-must-return-effect",
  "guarded-op-must-return-option",
  "no-cascading-layer-provide",
  "no-decode-unknown-option",
  "no-direct-browser-storage",
  "no-direct-fetch",
  "no-manual-field-guards",
  "no-nested-layer-provide",
  "no-nullish-default-on-partial-input",
  "no-raw-error-forwarding",
  "no-schema-class-modeling",
  "no-service-constructor-imports",
  "no-silent-error-swallow",
  "no-static-effect-service-forwarders",
  "no-try-catch",
  "no-unguarded-json-parse",
  "option-core-needs-effect-public",
  "prefer-die-for-precondition-defects",
  "prefer-effect-gen-for-guard-ladders",
  "prefer-effect-match",
  "prefer-effect-predicate-over-boolean-function",
  "prefer-named-guard-predicate",
  "prefer-option-pipeline",
  "prefer-ordering-match",
  "prefer-tagged-enum",
  "require-schema-type-derivation",
] as const;

const every = (): Record<string, "error"> =>
  Object.fromEntries([
    ...GENERIC.map((id) => [`plumb/${id}`, "error"]),
    ...EFFECT.map((id) => [`plumb-effect/${id}`, "error"]),
  ]);

/**
 * The Effect language service's rulebook, at one severity.
 *
 * The presets ship their rules as warnings; the category decides the severity
 * here, so a correctness rule is an error and a style rule is a warning without
 * listing 116 names. The union of the four categories is the whole rulebook.
 */
const atSeverity = (
  rules: Readonly<Record<string, unknown>> | undefined,
  severity: "error" | "warn",
): Record<string, "error" | "warn"> =>
  Object.fromEntries(Object.keys(rules ?? {}).map((id) => [id, severity]));

const EFFECT_TSGO = {
  ...atSeverity(correctness.rules, "error"),
  ...atSeverity(antipattern.rules, "error"),
  ...atSeverity(effectNative.rules, "warn"),
  ...atSeverity(style.rules, "warn"),
};

export default {
  ignorePatterns: ["node_modules", "tests/fixtures/**"],
  plugins: ["eslint", "oxc", "typescript", "unicorn", "jsdoc", "node", "effecttsgo"],
  // Every `effecttsgo/*` rule is type-aware, so oxlint's type-aware mode is on
  // for the whole run. The binary that answers it is the Effect language service,
  // wired in by `effect-tsgo patch --oxlint` from the `prepare` script.
  options: { typeAware: true },
  settings: { jsdoc: { mode: "typescript" } },
  jsPlugins: [
    // The installed package, which is what a consumer has. Its dist was three
    // rules behind its src until I rebuilt it, which is the same lesson as every
    // other stale artifact in this session: a build output is another thing that
    // can quietly disagree with its source.
    { name: "plumb", specifier: "@autotelic/plumb" },
    { name: "plumb-effect", specifier: "@autotelic/plumb/effect" },
  ],
  rules: {
    ...every(),
    ...EFFECT_TSGO,
    // plumb:allow-off: this rule is non-deterministic AND reports the pattern it
    // recommends. Read its detection: it collects schema names, collects every
    // interface, and reports the overlap at Program:exit without ever looking at
    // the `extends` clause -- so `interface X extends Schema.Schema.Type<typeof X>`
    // is reported as re-declaring X by hand. It also uses a createOnce visitor
    // with cross-file state, so the same tree reports 33, 39 or 40 findings
    // depending on the order files are visited. Both need fixing upstream before
    // this can hold a baseline; until then it cannot be part of a ratchet that is
    // supposed to be reproducible.
    // plumb-effect/require-schema-type-derivation is off (see above).
    //
    // deterministic-keys wants a path-derived key like
    // `<package>/<dir>/<ClassName>`. joggle's services are keyed
    // `@joggle/<ClassName>`: readable, stable, and set by hand beside the class.
    // The rule's key would be longer and no more honest, and the rule takes no
    // Oxlint options, so it is off with the reason rather than renamed to please
    // it.
    "effecttsgo/deterministic-keys": "off",
    // joggle's own schema-excludes-domain-value rule requires a wire schema to
    // admit what the domain produces, and the domain's offsets, counts and
    // probabilities are `number`. `Schema.Finite` narrows the wire format below
    // the domain and joggle reports the mismatch, so the schema stays
    // `Schema.Number` and this rule -- a style preference -- is the one that
    // yields. The house rule wins.
    "effecttsgo/schema-number": "off",
    //
    // effecttsgo/missing-pipeable-signature wants every exported fixed-arity
    // function to also carry a pipeable overload. That is right for a library
    // whose functions compose through `.pipe`; joggle's exported functions are
    // data-first and called directly, and its pipeable surface is the Effect
    // ones, not these. Re-spelling 80 exports to satisfy it would be ceremony
    // around an API shape nobody uses, so it is off with the reason instead.
    "effecttsgo/missing-pipeable-signature": "off",
    "plumb-effect/require-schema-type-derivation": "off",
  },

  /**
   * Declared exceptions, each with the reason written down.
   *
   * These are not suppressions. A suppression hides a finding; an exception
   * records that the rule and this codebase disagree about something, and says
   * what. Anything without a reason is missing from here on purpose.
   */
  overrides: [
    {
      // @autotelic/joggle/plugin exists to re-export a supported surface. A barrel export is
      // a smell in an application, where it hides what a module actually owns;
      // here the point IS the aggregate -- one name a rule author imports, and
      // one place to add the next thing to the contract. plumb's own rule cannot
      // know that, which is the whole reason the two tools are separate.
      files: ["src/plugin.ts"],
      rules: { "plumb/no-barrel-export-star": "off" },
    },
    {
      // `shape` is joggle's domain word. A declaration's SHAPE is its token
      // sequence with every identifier blanked, and `shapeHash` is that hashed;
      // `overlap` is the similarity between two of them. The rule reads "shape"
      // as structure-rather-than-ownership, which is right in general and
      // meaningless here -- there is no owner to name, because the shape is of
      // nothing in particular. Declared rather than renamed: renaming a domain
      // term to please a linter is the tool editing the domain.
      files: [
        "src/workspace.ts",
        "src/similarity.ts",
        "src/parsecache.ts",
        "src/rules/compose-types.ts",
        "src/rules/cluster-verdict.ts",
        "src/rules/object-shape.ts",
        "src/rules/duplicate-implementation.ts",
        "src/rules/call-pattern.ts",
        "src/rules/index.ts",
        "src/policy.ts",
      ],
      rules: { "plumb/no-shape-in-symbol-names": "off" },
    },
    {
      // The remedy requires an API this Effect version does not have: there is no
      // `decodeUnknownResult`, and `SchemaParser.decodeResult` takes a schema's
      // ENCODED type, which a JSON file read as `unknown` cannot supply without a
      // cast. The concern behind the rule is addressed instead -- a cache file
      // that fails to decode is recorded and reported, so a cache that quietly
      // stopped working no longer looks exactly like a cold one.
      files: ["src/parsecache.ts"],
      rules: { "plumb-effect/no-decode-unknown-option": "off" },
    },
    {
      // The decode bridge: raw AST nodes and raw plugin modules in, typed values
      // out. plumb carves out exactly this exception for its own bridge module --
      // its config says "Reflection/decode boundary modules: representation checks
      // and broad parameters are their purpose: they own the crossing between raw
      // AST/config payloads and typed rule logic" -- and that sentence describes
      // these three files word for word.
      //
      // What was measured before deciding it: decoding one AST node with a Schema
      // costs 213ns against 3ns for a typeof check, a factor of 73, and joggle
      // walks millions of nodes per run. oxc produced that AST in this process and
      // `parseSync` has a type for it, so Schema-validating it would be validating
      // our own output at 73 times the price. The alternative -- keeping oxc's
      // types and narrowing on `node.type` -- is the right long-term shape and is
      // not done here.
      //
      // Scoped to the rules that ARE the bridge: 113 of the 330 findings, and
      // 85 to 94 per cent of each of these rules' occurrences. Everything
      // else these files trip -- swappable parameters, missing JSDoc, sort
      // comparators -- is ordinary debt and stays in the baseline.
      //
      // `data-error-as-outage` joins them: it re-parses a candidate file and
      // narrows on `node.type` to find a guarded lookup and a 5xx, which is the
      // same crossing, and `guarded-op-must-return-option` is the same absence:
      // "this node was not the shape I was looking for" is the ordinary case in a
      // tree walk, not a value being conflated with `undefined`.
      files: [
        "src/workspace.ts",
        "src/imports.ts",
        "src/plugins.ts",
        "src/rules/data-error-as-outage.ts",
      ],
      rules: {
        "plumb/no-runtime-typeof": "off",
        "plumb/no-reinterpret-cast": "off",
        "plumb/require-safety-comment-for-type-assertion": "off",
        "plumb/no-unsafe-dictionary-type": "off",
        "plumb/no-unknown-parameters": "off",
        "plumb-effect/guarded-op-must-return-option": "off",
      },
    },
    {
      // `verdictOf` returns undefined when an answer carries no label and no
      // probability -- an unreadable answer, a real third outcome every caller
      // already branches on by reporting the candidate unverified. Wrapping it in
      // Option would move the same branch to ten call sites without adding a
      // distinction the domain does not have.
      files: ["src/verdict.ts"],
      rules: { "plumb-effect/guarded-op-must-return-option": "off" },
    },
    {
      // The trace bridge: raw `types_N.json` payloads in, typed facts out. This is
      // the same crossing the exception above describes, for the compiler's own
      // output rather than the AST. The payload is external JSON produced by a
      // program this run spawned, so representation checks and broad parameters
      // are this module's purpose, and a full Schema decode of 65,000 descriptors
      // per checker costs far more than the lookup it enables.
      //
      // `guarded-op-must-return-option` is here for the same reason: every lookup
      // asks "did the checker have anything to say", absence is the ordinary case,
      // and it is already a counted, reported fact -- a declaration that did not
      // join is visible in the run's notes. Wrapping each hop in Option would put
      // ceremony around a boundary that already records its own misses.
      files: ["src/typetrace.ts"],
      rules: {
        "plumb/no-runtime-typeof": "off",
        "plumb/no-unsafe-dictionary-type": "off",
        "plumb/no-unknown-parameters": "off",
        "plumb-effect/guarded-op-must-return-option": "off",
      },
    },
    {
      // The engine erases a plan's verdict type so plans from different rules can
      // travel in one request; a rule's phase puts it back at the boundary, where
      // it knows every answer came from its own questionnaire. The assertion is
      // the erasure boundary itself, and the SAFETY comment beside it states the
      // invariant.
      files: ["src/rules/cluster-verdict.ts", "src/plans.ts", "src/operation.ts"],
      rules: {
        "plumb/no-reinterpret-cast": "off",
        "plumb/no-unknown-parameters": "off",
        // A table with no opinion is an ordinary answer here, and the absence is
        // already a reported fact: `settle` says so in its reason, and the run
        // prints it. Wrapping each hop in Option would put ceremony around a
        // boundary that names its own misses.
        "plumb-effect/guarded-op-must-return-option": "off",
      },
    },
    {
      // A canonical JSON serializer accepts any JSON by definition. Its whole job
      // is that the same value produces the same string whatever its shape, so a
      // domain type on it would be a lie about what it does. The rules it trips
      // are the ones that ask for a named type at every boundary; the boundary
      // here IS the type.
      files: ["src/canonical.ts"],
      rules: {
        "plumb/no-unknown-parameters": "off",
        "plumb/no-unknown-returns": "off",
        "plumb/no-unsafe-dictionary-type": "off",
        "plumb/no-known-value-widening": "off",
      },
    },
    {
      // `Effect.gen(function* () { ... return x })` with no `yield` is idiomatic
      // Effect: the generator IS the effect, and a rule body with no effectful
      // steps still returns through one. eslint's rule predates Effect and cannot
      // see that, which is a gap worth reporting upstream rather than a decision
      // to make here -- but it is six sites, not a policy.
      files: ["src/rules/**"],
      rules: { "eslint/require-yield": "off" },
    },
    {
      // Policy, decided rather than drifted into. joggle keeps inline comments
      // for the REASONING -- why this threshold, why this shape, what the failure
      // looked like -- and JSDoc for the CONTRACT. plumb wants all of it in JSDoc,
      // and it has a real point: an inline comment is invisible to tooling. But
      // the reasoning belongs where the decision is made, and moving four hundred
      // of them onto the signatures above would put the explanation of a line
      // forty lines away from the line.
      //
      // The other half of the same rule family, `require-jsdoc-on-exported`, is
      // NOT excepted: an exported contract without a doc block is a real gap, and
      // the 28 it reports are work rather than disagreement.
      files: ["src/**", "scripts/**"],
      rules: { "plumb/no-stray-inline-comments": "off" },
    },
    {
      // The rule wants every layer composed and provided once, at the entry
      // point. These three ARE the entry points, and each builds the layers its
      // own command needs: main.ts is the CLI root, check.ts composes the
      // per-run layers, and testing.ts is a test's. There is no earlier place to
      // provide them, which is the exception the rule itself names.
      files: ["src/main.ts", "src/check.ts", "src/testing.ts"],
      rules: { "effecttsgo/strict-effect-provide": "off" },
    },
    {
      // A key that is ABSENT and a key present-and-undefined are different
      // shapes under exactOptionalPropertyTypes, and the conditional spread is
      // how one is omitted. The alternatives set the key to undefined, which is
      // the other shape. This is the rule and the code disagreeing about which
      // of the two a config merge should produce, and the code's answer is
      // written beside it.
      files: ["src/plugins.ts", "src/parsecache.ts"],
      rules: { "plumb/no-conditional-empty-object-spread": "off" },
    },
    {
      // Lookup tables indexed by a runtime string. The annotation is what gives
      // them an index signature; `satisfies` would keep the literal's keys and
      // then reject the dynamic lookup the table exists for. Here the widening
      // is the type, not evidence thrown away.
      files: [
        "src/vocabulary.ts",
        "src/report.ts",
        "src/rules/naming-drift.ts",
        "src/rules/language-drift.ts",
        "src/workspace.ts",
      ],
      rules: { "plumb/no-known-value-widening": "off" },
    },
    {
      // joggle writes its caches with canonical JSON on purpose: identity is a
      // canonical string, and plumb's own
      // require-canonical-stringify-for-identity is the same decision from the
      // other side. Every read already decodes with a Schema. Re-encoding the
      // writes through Schema would change the on-disk bytes and buy nothing
      // the canonical form does not.
      files: [
        "src/typetrace.ts",
        "src/decision.ts",
        "src/run-cache.ts",
        "src/parsecache.ts",
        "src/main.ts",
      ],
      rules: { "effecttsgo/prefer-schema-over-json": "off" },
    },
    {
      // The rule reads "hoist ... into <name>", "import it from all of them" and
      // "A domain_concept module imports a domain_concept module" as SQL
      // interpolation. They are the sentences a finding prints, prose built from
      // the cluster's own members, not a query.
      files: ["src/rules/cluster-verdict.ts", "src/rules/module-direction.ts"],
      rules: { "plumb/no-sql-string-interpolation": "off" },
    },
    {
      // The rule reads `interface X extends Schema.Schema.Type<typeof X>` as a
      // class instance, but the type is a plain object: the spread copies fields
      // and there is no prototype to lose. A false positive from type-aware mode
      // on every Schema-derived interface in the tree.
      files: ["src/decision.ts", "src/plugins.ts", "src/check.ts"],
      rules: { "typescript/no-misused-spread": "off" },
    },
    {
      // Module-scope lookup helpers. Absence is the ordinary answer -- a file in
      // no layer, a module that could not be classified, a pattern that does not
      // parse, a manifest with no entry -- and each miss is already recorded as
      // a fact: a layer of undefined is handled, an unclassified module is
      // counted, a parse failure is reported. Wrapping each hop in Option would
      // move the same branch to a dozen call sites without adding a distinction
      // the domain has, which is the exception the four groups above already
      // record for the lookups they name.
      files: [
        "src/roles.ts",
        "src/gitignore.ts",
        "src/config.ts",
        "src/bundles.ts",
        "src/architecture.ts",
        "src/fingerprint.ts",
        "src/parsecache.ts",
        "src/vocabulary.ts",
        "src/rules/reimplemented-primitive.ts",
        "src/main.ts",
      ],
      rules: { "plumb-effect/guarded-op-must-return-option": "off" },
    },
    {
      // `@effect-expect-leaking` is the Effect language service's own marker for
      // a dependency a service passes through on purpose. The jsdoc plugin does
      // not know the tag, so the two rulebooks disagree about it; the tag is
      // required and the name check is what loses.
      files: ["src/tsgo.ts"],
      rules: { "jsdoc/check-tag-names": "off" },
    },
    {
      // `ignored`, `ignoredDirectories` and `truncated` are `let` accumulators
      // local to the walk's generator, added to as each child directory returns.
      // The rule reads them as module scope; nothing in this file exports them
      // and no caller can see the mutation.
      files: ["src/workspace.ts"],
      rules: { "plumb/no-exported-mutable-state": "off" },
    },
    {
      // The Effect `Crypto` and `Path` are services, and these are synchronous
      // boundaries with no Effect context: the content hash in the canonical
      // cache key, and path arithmetic inside sync helpers. The service is used
      // wherever a run has one; the platform module is what is left at the edge.
      files: ["src/state.ts", "src/tsgo.ts", "src/typefacts.ts"],
      rules: { "effecttsgo/node-builtin-import": "off" },
    },
    {
      // The TypeScript compiler API is async, so this boundary is too, and its
      // caller already wraps the whole call in Effect.tryPromise -- which is
      // where the Effect value is made. Making the implementation itself Effect
      // would put tryPromise around each await and change the export for no gain.
      files: ["src/typefacts.ts"],
      rules: { "effecttsgo/async-function": "off" },
    },
    {
      // `Options` is a bag of independent run choices -- carry tsgo's own
      // diagnostics, resolve types, discover with tsgo, replay, scope -- not a
      // state machine. Every combination is meaningful and none is invalid, so
      // there is no union to classify into. The rule assumes boolean flags that
      // encode one state; these do not.
      files: ["src/check.ts"],
      rules: { "plumb/no-boolean-field-signals": "off" },
    },
    {
      // `exported`, `typed` and `test` are three independent facts about a
      // declaration, each read on its own. None implies another and no
      // combination is invalid, so a tagged union would model a state that does
      // not exist.
      files: ["src/workspace.ts"],
      rules: { "plumb/no-boolean-field-signals": "off" },
    },
  ],
};
