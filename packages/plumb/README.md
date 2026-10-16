# plumb

Opinionated [Oxlint](https://oxc.rs) rules that keep TypeScript *true*: a plumb line for your codebase. The plugins also run under ESLint (see [Using Plumb with ESLint](#using-plumb-with-eslint)).

## Plugins

- **`plumb`**: generic rules that reject low-evidence and low-signal implementation patterns (49 rules).
- **`plumb-effect`**: opt-in rules for Effect service and Layer architecture (26 rules). Enable only in repos that depend on `effect`.
- **`plumb-react`**: opt-in React composition rules (4 rules). Enable only in React repos.
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
