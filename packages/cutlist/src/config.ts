import { Effect, FileSystem, Result, Schema, SchemaParser } from "effect"
import type { CutlistConfig, CutlistOutput } from "@autotelic/protocol"

/*
 * `cutlist.config.json` — the repo's vocabulary, not shakti's.
 *
 * The proposal this tool comes from asserts the *rules* are generic while the
 * vocabulary is per-project, then hardcodes shakti's paths. This file is the fix: the
 * crawler reads nothing it was not told. Roots, alias, tiers, token source, ownership
 * rule, and the convention packs all arrive here, so the same binary points at any repo.
 */

const TiersSchema = Schema.Struct({
  primitive: Schema.Array(Schema.String),
  shared: Schema.Array(Schema.String),
  local: Schema.Array(Schema.String),
})

const TokenSourceSchema = Schema.Struct({
  from: Schema.String,
  theme: Schema.optionalKey(Schema.String),
  vars: Schema.optionalKey(Schema.String),
})

const CompositionPatternSchema = Schema.Struct({
  providerSuffix: Schema.String,
  hookPrefix: Schema.String,
})

const UrlStatePatternSchema = Schema.Struct({
  router: Schema.Literals(["remix", "tanstack", "next", "react-router"]),
  reader: Schema.String,
})

const PatternsSchema = Schema.Struct({
  composition: Schema.optionalKey(CompositionPatternSchema),
  urlState: Schema.optionalKey(UrlStatePatternSchema),
})

const HooksSchema = Schema.Struct({ barrel: Schema.optionalKey(Schema.String) })

const OwnershipSchema = Schema.Struct({
  routeOwner: Schema.Literals(["first-segment", "full"]),
  transitive: Schema.Boolean,
})

const OutputSchema = Schema.Struct({
  catalog: Schema.optionalKey(Schema.String),
  manifest: Schema.optionalKey(Schema.String),
  menu: Schema.optionalKey(Schema.String),
  hooks: Schema.optionalKey(Schema.String),
  tokens: Schema.optionalKey(Schema.String),
})

/** The decoded config. The TypeScript type is `protocol`'s, so the two cannot drift. */
export const CutlistConfigSchema = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  roots: Schema.Array(Schema.String),
  alias: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  tiers: TiersSchema,
  tokens: TokenSourceSchema,
  hooks: Schema.optionalKey(HooksSchema),
  ownership: OwnershipSchema,
  patterns: Schema.optionalKey(PatternsSchema),
  output: Schema.optionalKey(OutputSchema),
})

/** Where the renderings go, each resolved. */
export const defaultOutput: Required<CutlistOutput> = {
  catalog: "tools/ui-catalog/catalog.json",
  manifest: "tools/ui-catalog/plumb-ui.config.json",
  menu: "tools/ui-catalog/MENU.md",
  hooks: "tools/ui-catalog/hooks.md",
  tokens: "tools/ui-catalog/tokens.md",
}

/**
 * The config a repo gets when it declares none.
 *
 * It is deliberately a plausible default rather than an error: `cutlist build` on a
 * fresh repo should produce a report to argue with, and the first thing that report
 * says is "you have not told me your vocabulary."
 */
export const defaultConfig: CutlistConfig = {
  roots: ["app"],
  tiers: { primitive: ["components/ui"], shared: ["components"], local: ["routes"] },
  tokens: { from: "tailwind.config.ts" },
  ownership: { routeOwner: "first-segment", transitive: false },
  output: defaultOutput,
}

/** Read a repo's config, or the default when it has none or it does not decode. */
export const loadConfig = (
  file: string,
): Effect.Effect<CutlistConfig, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return defaultConfig
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    const decoded = Result.getOrUndefined(
      SchemaParser.decodeResult(Schema.fromJsonString(CutlistConfigSchema))(text),
    )
    return decoded ?? defaultConfig
  })

/** The config's outputs with every default filled in. */
export const outputOf = (config: CutlistConfig): Required<CutlistOutput> => ({
  catalog: config.output?.catalog ?? defaultOutput.catalog,
  manifest: config.output?.manifest ?? defaultOutput.manifest,
  menu: config.output?.menu ?? defaultOutput.menu,
  hooks: config.output?.hooks ?? defaultOutput.hooks,
  tokens: config.output?.tokens ?? defaultOutput.tokens,
})
