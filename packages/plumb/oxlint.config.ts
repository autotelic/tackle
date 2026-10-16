import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["node_modules"],
  // NOTE: `plugins` replaces the default-on set; list everything we rely on.
  plugins: ["eslint", "oxc", "typescript", "unicorn", "jsdoc", "node"],
  settings: {
    jsdoc: { mode: "typescript" },
  },
  jsPlugins: [
    { name: "plumb", specifier: "./src/index.ts" },
    { name: "plumb-meta", specifier: "./src/meta/index.ts" },
    { name: "plumb-react", specifier: "./src/react/index.ts" },
  ],
  rules: {
    // plumb: every rule this repo ships, enforced on itself.
    // plumb-effect rules stay consumer-opt-in: plumb is not an Effect application.
    "plumb/no-builtin-throws": "error",
    "plumb/no-boolean-field-signals": "error",
    "plumb/no-barrel-export-star": "error",
    "plumb/no-generic-export-names": "error",
    "plumb/no-swappable-primitive-params": "error",
    "plumb/no-transposed-field-reads": "error",
    "plumb/no-vague-test-filenames": "error",
    "plumb/no-chained-type-assertions": "error",
    "plumb/no-conditional-empty-object-spread": "error",
    "plumb/no-impossible-branch-throw": "error",
    "plumb/no-known-value-widening": "error",
    "plumb/no-module-mocking": "error",
    "plumb/no-object-parameters": "error",
    "plumb/no-product-of-state-booleans": "error",
    "plumb/no-reflect-apply": "error",
    "plumb/no-reflect-get": "error",
    "plumb/no-reinterpret-cast": "error",
    "plumb/no-runtime-typeof": "error",
    "plumb/no-sentinel-comparison-union": "error",
    "plumb/no-stray-inline-comments": "error",
    "plumb/no-tag-ladder-assertions": "error",
    "plumb/no-redundant-derived-field": "error",
    "plumb/no-nondeterministic-core": "error",
    "plumb/no-exported-mutable-state": "error",
    "plumb/no-anonymous-wide-tuples": "error",
    "plumb/no-duplicated-literal-union": "error",
    "plumb/require-canonical-stringify-for-identity": "error",
    "plumb/require-deprecated-tag-for-legacy-comments": "error",
    "plumb/require-sort-comparator": "error",
    "plumb/require-exhaustive-tag-switch": "error",
    "plumb/no-shape-in-symbol-names": "error",
    "plumb/no-unknown-parameters": "error",
    "plumb/no-unknown-returns": "error",
    "plumb/no-unknown-type-aliases": "error",
    "plumb/no-unit-return-validators": "error",
    "plumb/no-unsafe-dictionary-type": "error",
    "plumb/no-widen-then-assert": "error",
    "plumb/no-stacked-jsdoc-blocks": "error",
    "plumb/prefer-payload-brand": "error",
    "plumb/require-fc-block-predicate": "error",
    "plumb/require-jsdoc-on-exported": "error",
    "plumb/require-published-order": "error",
    "plumb/require-safety-comment-for-type-assertion": "error",
    "plumb/prefer-property-tests": "error",
    "plumb/no-multiple-function-params": "error",
    "plumb/no-optional-function-parameters": "error",
    "plumb/no-single-use-private-functions": "error",
    "plumb/no-mutable-environment-capture": "error",
    "plumb/no-sql-string-interpolation": "error",
    "plumb-meta/no-manual-ancestor-walks": "error",
    "plumb-meta/prefer-before-file-scope": "error",
    "plumb-meta/require-create-once": "error",
    "plumb-meta/no-disable-directives": "error",

    // plumb-react: opt-in React composition rules (the "perfect component" contract).
    "plumb-react/require-tripartite-context": "error",
    "plumb-react/require-guarded-context-hook": "error",
    "plumb-react/require-dot-notation-exports": "error",
    "plumb-react/use-encapsulation": "error",

    // regexp: flag-sensitive syntax must fail loudly, not silently change meaning.
    "require-unicode-regexp": "error",

    // jsdoc: annotation quality for every documented contract.
    "jsdoc/require-param": "error",
    "jsdoc/require-param-description": "error",
    "jsdoc/require-param-name": "error",
    "jsdoc/require-param-type": "error",
    "jsdoc/require-returns": "error",
    "jsdoc/require-returns-description": "error",
    "jsdoc/require-returns-type": "error",
    "jsdoc/check-tag-names": "error",
    "jsdoc/no-blank-blocks": "error",
  },
  overrides: [
    // Reflection/decode boundary modules: representation checks and broad
    // parameters are their purpose: they own the crossing between raw
    // AST/config payloads and typed rule logic.
    {
      // The RuleTester adapter exists to expose an ESLint-style `create` (its
      // entire purpose), and lifecycle orchestration suites are example-driven
      // rather than property-driven.
      files: ["src/testing/**"],
      rules: {
        "plumb-meta/require-create-once": "off", // plumb:allow-off compat adapter owns the create crossing
        "plumb/prefer-property-tests": "off", // plumb:allow-off lifecycle sequencing is example-driven
        "plumb/no-reinterpret-cast": "off", // plumb:allow-off typed bridge to the tester's call shape
        "plumb/no-chained-type-assertions": "off", // plumb:allow-off same bridge
        "plumb/require-safety-comment-for-type-assertion": "off", // plumb:allow-off same bridge
        "plumb/no-unknown-returns": "off", // plumb:allow-off passthrough fragments re-enter typed land at callsites
      },
    },
    {
      files: [
        "src/shared/structural.ts",
        "src/shared/rule-options.ts",
        "src/shared/ancestors.ts",
      ],
      rules: {
        // plumb:allow-off: typed bridge over raw payloads; casts JSDoc-documented
        "plumb/no-reinterpret-cast": "off", // plumb:allow-off typed bridge over raw payloads
        "plumb/no-runtime-typeof": "off", // plumb:allow-off decode boundary for config JSON
        "plumb/no-object-parameters": "off", // plumb:allow-off structural reader takes broad node objects
        "plumb/no-unsafe-dictionary-type": "off", // plumb:allow-off record values are the raw payload domain
        "plumb/no-unknown-parameters": "off", // plumb:allow-off reflection input is unknown by definition
        "plumb/no-multiple-function-params": "off", // plumb:allow-off reflection reader takes node+key pairs
        // plumb:allow-off: bridge-module casts carry JSDoc SAFETY notes
        "plumb/no-chained-type-assertions": "off", // plumb:allow-off bridge casts documented in JSDoc
        "plumb/require-safety-comment-for-type-assertion": "off", // plumb:allow-off bridge casts documented in JSDoc
      },
    },
    {
      // Test harnesses adapt plugin objects to RuleTester; the adapter casts
      // are confined to these files and covered by the suites themselves.
      files: ["src/**/*.test.ts"],
      rules: {
        "plumb/no-chained-type-assertions": "off", // plumb:allow-off bridge casts documented in JSDoc
        "plumb/require-safety-comment-for-type-assertion": "off", // plumb:allow-off bridge casts documented in JSDoc
      },
    },
    {
      files: ["src/**/*.ts"],
      rules: {
        // rule implementations legitimately use regex tests and helpers
        "unicorn/prefer-string-starts-ends-with": "off",
        "eslint/no-unused-vars": "off",
      },
    },
    {
      // plumb:allow-off: RuleTester adapter typing requires reinterpretation
      // at the plugin boundary; assertions are confined to these files.
      files: ["src/**/*.test.ts"],
      rules: {
        "plumb/no-reinterpret-cast": "off", // plumb:allow-off typed bridge over raw payloads
        "plumb-meta/require-rule-tester": "error",
      },
    },
    {
      // Test harness helpers adapt plugin objects to RuleTester; their loose
      // parameters, casts, and arity are the adapter surface itself.
      files: ["src/rules/test-utils.ts"],
      rules: {
        "plumb/no-multiple-function-params": "off", // plumb:allow-off adapter arity
        "plumb/no-unknown-parameters": "off", // plumb:allow-off engine-typed passthroughs
        "plumb/no-reinterpret-cast": "off", // plumb:allow-off compat-layer recovery
        "plumb/no-chained-type-assertions": "off", // plumb:allow-off compat-layer recovery
        "plumb/require-safety-comment-for-type-assertion": "off", // plumb:allow-off compat-layer recovery
      },
    },
  ],
});
