import { Effect, FileSystem, Result, Schema, SchemaParser } from "effect"
import type { HarnessConfig } from "@autotelic/protocol"

/*
 * `jig.config.json` — which engines are active, and how a run is gated.
 *
 * Each engine keeps its own config file; this one only says who runs and what counts as
 * failure. The default enables the whole family so a fresh repo's first `jig check`
 * runs everything that is installed and reports a note for what is not — the census is
 * the answer to "what did you actually look at".
 */

const EngineRefSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["process", "oxlint-plugin", "internal"]),
  command: Schema.optionalKey(Schema.String),
  config: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
})

const GateSchema = Schema.Struct({
  mode: Schema.Literals(["touched-files", "all"]),
  baseline: Schema.String,
  failOn: Schema.optionalKey(Schema.Literals(["error", "warn", "any-new"])),
})

const ReportSchema = Schema.Struct({
  format: Schema.optionalKey(Schema.Literals(["text", "json", "jsonl", "github"])),
  maxWarnings: Schema.optionalKey(Schema.Number),
})

const AgentSchema = Schema.Struct({
  cookbook: Schema.optionalKey(Schema.String),
  onboarding: Schema.optionalKey(Schema.String),
})

export const HarnessConfigSchema = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  engines: Schema.Array(EngineRefSchema),
  gate: GateSchema,
  report: Schema.optionalKey(ReportSchema),
  agent: Schema.optionalKey(AgentSchema),
})

/** What a repo gets before it declares anything: the whole family, gated on new findings. */
export const defaultConfig: HarnessConfig = {
  engines: [
    { id: "cutlist", kind: "process", command: "cutlist" },
    { id: "plumb", kind: "oxlint-plugin", command: "oxlint" },
    { id: "joggle", kind: "process", command: "joggle" },
  ],
  gate: { mode: "all", baseline: ".jig-baseline.json", failOn: "any-new" },
  report: { format: "text", maxWarnings: -1 },
  agent: { cookbook: "JIG.md" },
}

/** Read a repo's harness config, or the default when it has none or it does not decode. */
export const loadConfig = (
  file: string,
): Effect.Effect<HarnessConfig, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return defaultConfig
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    return (
      Result.getOrUndefined(
        SchemaParser.decodeResult(Schema.fromJsonString(HarnessConfigSchema))(text),
      ) ?? defaultConfig
    )
  })
