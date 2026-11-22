# plumb

Opinionated [Oxlint](https://oxc.rs) rules that keep TypeScript *true*: a plumb line for your codebase. The plugins also run under ESLint (see [Using Plumb with ESLint](#using-plumb-with-eslint)).

## Plugins

- **`plumb`**: generic rules that reject low-evidence and low-signal implementation patterns (49 rules).
- **`plumb-effect`**: opt-in rules for Effect service and Layer architecture (27 rules). Enable only in repos that depend on `effect`.
- **`plumb-react`**: opt-in React composition rules (4 rules). Enable only in React repos.
- **`plumb-ui`**: opt-in catalog rules (1 rule). Reads cutlist's generated manifest; `no-deprecated-parts` reports an import of a part whose authored intent marks it `deprecated`, naming the recorded replacement. Fails open when the manifest is missing or malformed; `cutlist build --check` is the gate that keeps it current.
- **`plumb/configs`**: shared rule sets (`plumbRecommendedRules`, `plumbEffectRecommendedRules`, `plumbReactRecommendedRules`) that enable every rule in a plugin at `error`, for either linter.
- **`plumb/testing`**: RuleTester lifecycle adapter (`testableRule`, `wireRuleTester`, `createTester`) so `createOnce` rules with `before`/`after` hooks test correctly under the ESLint-compatible `create` path.

## Consuming

### 1. Add the dependency (public npm, no tokens or registry config needed)

```sh
pnpm add -D @autotelic/plumb
```

### 2. Register the plugins in your oxlint config

Point `jsPlugins` straight at the installed package: no copies, updates are just a version bump:

```ts
// oxlint.config.ts
jsPlugins: [
  { name: "plumb", specifier: "@autotelic/plumb" },
  { name: "plumb-effect", specifier: "@autotelic/plumb/effect" },
],
rules: {
  "plumb/no-builtin-throws": "error",
  "plumb-effect/guarded-op-must-return-effect": "error",
},
```

If your setup does not resolve package exports for plugin specifiers, point directly at the compiled files instead (the package ships `dist/` only):

```ts
jsPlugins: [
  { name: "plumb", specifier: "./node_modules/@autotelic/plumb/dist/index.js" },
  { name: "plumb-effect", specifier: "./node_modules/@autotelic/plumb/dist/effect/index.js" },
],
ignorePatterns: ["node_modules/**"],
```

### 3. Or enable whole plugins with the shared rule sets

Each rule set enables every rule in its plugin at `error`, and grows automatically when a release adds rules. Spread it into `rules`, then override individual rules after it. This needs a JS/TS config (`oxlint.config.ts`), since `.oxlintrc.json` can't import modules.

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";
import { plumbRecommendedRules, plumbEffectRecommendedRules } from "@autotelic/plumb/configs";

export default defineConfig({
  jsPlugins: [
    { name: "plumb", specifier: "@autotelic/plumb" },
    { name: "plumb-effect", specifier: "@autotelic/plumb/effect" },
  ],
  rules: {
    ...plumbRecommendedRules,
    ...plumbEffectRecommendedRules,
    "plumb/require-jsdoc-on-exported": "off",
  },
});
```

The rule ids assume each plugin is registered under its own name: `plumb`, `plumb-effect`, `plumb-react`.

### 4. Catalog rules (`plumb-ui`)

`plumb-ui` is separate from the recommended sets because it needs a generated manifest. Point it at the file `cutlist build` writes:

```ts
// oxlint.config.ts
jsPlugins: [{ name: "plumb-ui", specifier: "@autotelic/plumb/ui" }],
rules: {
  "plumb-ui/no-deprecated-parts": [
    "error",
    { manifest: "tools/ui-catalog/plumb-ui.config.json" },
  ],
},
```

The manifest option is a path or an already-decoded manifest object; it defaults to `tools/ui-catalog/plumb-ui.config.json`. A part is a promise: the catalog records `status: deprecated` and `useInstead`, and the rule makes an unmigrated import visible at the call site. If the manifest cannot be read, the rule reports nothing rather than inventing a migration.


## Repo-local guardrail plugins

Some rules are nobody's package: they encode one repository's own decisions ("ask the
policy engine, never the shared instance", "no role literals in a handler"). Write them
as a local jsPlugin beside plumb, registered the same way:

```ts
jsPlugins: [
  { name: "plumb", specifier: "@autotelic/plumb" },
  { name: "authorization", specifier: "./tools/oxlint/guardrails/authorization.cjs" },
],
rules: { "authorization/no-direct-shared-client": "error" },
```

One rule of thumb, learned the hard way: **the rule's path scope is a policy decision,
so it belongs in config, not in the rule.** A guardrail scoped with a hardcoded path
test ("handlers only") permanently exempts every file outside the path — and the file
that escapes is, in practice, the one with the bug the rule exists to catch. A real
case: a "never read the shared `fastify.oso`" rule scoped to `handlers/` left a direct
read in `shared/` live forever, because the ratchet could never collect it.

Instead, take the scope from the config's `settings` and name the exemptions there, so
the boundary is reviewable and the exempt file is at least written down somewhere:

```js
create(context) {
  const options = context.options[0] ?? {}
  const include = options.include ?? ["/handlers/"]
  const exempt = new Set(options.exempt ?? [])
  if (!include.some((part) => context.filename.includes(part))) return {}
  if (exempt.has(context.filename)) return {}
  // ...
}
```

```ts
rules: { "authorization/no-direct-shared-client": ["error", { include: ["/src/"], exempt: ["src/plugins/policy/index.ts"] }] }
```

The exempt list is where the debt lives in daylight: a file named there is a finding
waiting for its zeroing batch, not a file the rule was never allowed to see.

## Using Plumb with ESLint

Every plugin is ESLint-compatible, so the same rules run under ESLint with the same findings. Use this where Oxlint can't parse the files: Astro, Vue and Svelte templates. Pair ESLint's framework parser with `@typescript-eslint/parser` for the script parts, and keep Oxlint for plain TypeScript if you want its speed.

```js
// eslint.config.js
import astroParser from "astro-eslint-parser";
import tsParser from "@typescript-eslint/parser";
import plumb from "@autotelic/plumb";
import { plumbRecommendedRules } from "@autotelic/plumb/configs";

export default [
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: { parser: tsParser, extraFileExtensions: [".astro"] },
    },
    plugins: { plumb },
    rules: { ...plumbRecommendedRules },
  },
];
```

Vue (`vue-eslint-parser`) and Svelte (`svelte-eslint-parser`) work the same way: swap the parser and file glob. Register the plugins under the same names as in Oxlint so rule ids, and the shared rule sets, line up across both linters.

If you type-check an `eslint.config.ts`, the plugin objects need a cast: Oxlint's `Plugin` type allows `meta.fixable: null`, which ESLint's type doesn't. The runtime objects are what ESLint expects.

## Updating

```sh
pnpm up @autotelic/plumb          # bump to the latest published version
```

## Releasing (maintainers)

Releases publish to public npm automatically when a GitHub Release is published; the `Publish` workflow runs `pnpm check` and `pnpm build`, then runs `npm publish` authenticated with the `NPM_PUBLISH_TOKEN` repository secret.

1. Update `version` in `package.json` and merge.
2. Create a GitHub Release for `vX.Y.Z`.
3. The workflow publishes to npmjs; verify the package version on npm.

## Development

```sh
pnpm install
pnpm check   # lint + typecheck + test + rule/config consistency
```
