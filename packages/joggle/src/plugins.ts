import { Effect, FileSystem, Path } from "effect"
import { pathToFileURL } from "node:url"
import { shortHash } from "./state.ts"
import type { Rule } from "./rule.ts"
import type { JoggleConfig } from "./config.ts"

/**
 * Rules that arrive from the repository instead of from this package.
 *
 * A linter is a registry. `allRules` is a hardcoded array in this package, which
 * makes the rule CONTRACT pluggable and the rule SET closed: writing an opinion
 * of your own means forking the tool. ESLint solved this and the shape is worth
 * copying -- a rule is a value, a plugin is a module that exports values, and the
 * config says which ones to run.
 *
 * A plugin module exports `rules`. Nothing else about it is special, so a plugin
 * is also how a PRESET ships: the opinions in this package could be published as
 * one, and a repository could enable it alongside its own.
 *
 * Two things this deliberately does not do:
 *
 * - It does not swallow a plugin that fails to load. A rule that silently is not
 *   there is worse than one that errors, because the report looks clean.
 * - It does not skip fingerprinting. `policy.analysisVersion` was a hand-bumped
 *   string that got forgotten twice, and the same hole opens the moment a rule
 *   can live outside the directory this tool hashes: an edited plugin with an
 *   unchanged path would replay a stale report. Each plugin's own source is
 *   hashed into the run manifest for that reason.
 */
export interface Loaded {
  readonly rules: ReadonlyArray<Rule>
  /** Plugins that could not be loaded, and why. Reported, never dropped. */
  readonly failures: ReadonlyArray<{ readonly specifier: string; readonly reason: string }>
  /** Content hashes, one per loaded plugin. */
  readonly fingerprints: ReadonlyArray<string>
  /**
   * Defaults the plugins carry, applied UNDER the repository's own config.
   *
   * This is what makes a preset a preset rather than just a bundle of rules: a
   * package of opinions arrives with its severities and its scoping, and the
   * repository overrides any of it. A preset with no defaults is a plugin, and the
   * difference is entirely in this field.
   */
  readonly config: JoggleConfig
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"]

/** A module specifier, the root it resolves from, and the path service. */
interface PluginRequest {
  readonly specifier: string
  readonly cwd: string
  readonly path: Path.Path
}

/**
 * What to hand to `import`.
 *
 * A bare specifier is returned UNCHANGED, so the runtime resolves it. That is
 * what makes a published plugin work without this knowing how packages are
 * installed -- and it is how a preset shipped alongside the tool is found by its
 * own package name, since Node resolves a package's name from inside it.
 *
 * Converting it to a file URL first, which is what this did, turns
 * `@autotelic/joggle/presets/composition` into a path under the working directory and fails
 * with "cannot find module /repo/@autotelic/joggle/presets/composition".
 */
const resolve = ({ specifier, cwd, path }: PluginRequest): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return specifier
    const fs = yield* FileSystem.FileSystem
    const base = path.isAbsolute(specifier) ? specifier : path.join(cwd, specifier)
    for (const candidate of [base, ...EXTENSIONS.map((extension) => base + extension)]) {
      if (yield* Effect.orElseSucceed(fs.exists(candidate), () => false)) {
        return pathToFileURL(candidate).href
      }
    }
    return pathToFileURL(base).href
  })

const configOf = (module: unknown): JoggleConfig | undefined => {
  if (typeof module !== "object" || module === null) return undefined
  const declared = (module as Record<string, unknown>)["config"]
  return declared !== undefined && typeof declared === "object"
    ? (declared as JoggleConfig)
    : undefined
}

/**
 * Several plugins' defaults, first one winning on a conflict.
 *
 * Ordered rather than merged-last-wins because the order is the repository's:
 * the presets it lists first are the ones it expects to shape the run.
 */
export const mergeConfigs = (configs: ReadonlyArray<JoggleConfig>): JoggleConfig => {
  const rules: Record<string, NonNullable<JoggleConfig["rules"]>[string]> = {}
  const ignore: Array<NonNullable<JoggleConfig["ignore"]>[number]> = []
  for (const config of [...configs].reverse()) {
    for (const [id, setting] of Object.entries(config.rules ?? {})) rules[id] = setting
    ignore.push(...(config.ignore ?? []))
  }
  return {
    ...(Object.keys(rules).length === 0 ? {} : { rules }),
    ...(ignore.length === 0 ? {} : { ignore }),
  }
}

/**
 * The repository's config over a preset's defaults.
 *
 * Per rule, so a preset that enables twenty opinions and sets their severities
 * lets the repository turn one of them off without restating the other nineteen.
 */
export const withDefaults = (defaults: JoggleConfig, own: JoggleConfig): JoggleConfig => ({
  ...defaults,
  ...own,
  rules: { ...defaults.rules, ...own.rules },
  ignore: [...(own.ignore ?? []), ...(defaults.ignore ?? [])],
  // Omitted rather than set to undefined: exact optional properties distinguish
  // the two, and a key present-but-undefined is not the same shape as an absent one.
  ...(own.architecture === undefined && defaults.architecture === undefined
    ? {}
    : { architecture: own.architecture ?? defaults.architecture }),
  ...(own.evidence === undefined && defaults.evidence === undefined
    ? {}
    : { evidence: own.evidence ?? defaults.evidence }),
  ...(own.plugins === undefined ? {} : { plugins: own.plugins }),
  ...(own.presets === undefined ? {} : { presets: own.presets }),
})

const rulesOf = (module: unknown): ReadonlyArray<Rule> => {
  if (typeof module !== "object" || module === null) return []
  const exported = (module as Record<string, unknown>)["rules"]
  return Array.isArray(exported) ? (exported as ReadonlyArray<Rule>) : []
}

/** Load the configured rule modules, relative specifiers resolved against the analysed root. */
export const loadPlugins = (
  specifiers: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<Loaded, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (specifiers.length === 0) {
      return { rules: [], failures: [], fingerprints: [], config: {} }
    }
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const rules: Array<Rule> = []
    const failures: Array<{ specifier: string; reason: string }> = []
    const fingerprints: Array<string> = []
    const configs: Array<JoggleConfig> = []

    for (const specifier of specifiers) {
      // A specifier that resolves to nothing is not special-cased: `import`
      // fails on it and the runtime's own message is the failure reason, which
      // is more accurate than anything this could invent.
      const resolved = yield* resolve({ specifier, cwd, path })

      const attempt = yield* Effect.tryPromise({
        try: () => import(resolved),
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }).pipe(
        Effect.map((module) => ({ ok: true as const, module })),
        Effect.catch((reason) => Effect.succeed({ ok: false as const, reason })),
      )

      if (!attempt.ok) {
        failures.push({ specifier, reason: attempt.reason })
        continue
      }
      const found = rulesOf(attempt.module)
      if (found.length === 0) {
        failures.push({ specifier, reason: "loaded, but exports no `rules` array" })
        continue
      }
      rules.push(...found)
      const declared = configOf(attempt.module)
      if (declared !== undefined) configs.push(declared)

      // The plugin's own source, so editing it invalidates the run cache the same
      // way editing this package does.
      const text = yield* Effect.orElseSucceed(fs.readFileString(resolved), () => "")
      fingerprints.push(specifier + "\u0000" + shortHash(text))
    }

    return {
      rules,
      failures,
      fingerprints,
      config: mergeConfigs(configs),
    }
  })
