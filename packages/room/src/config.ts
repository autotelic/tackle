import { Effect, FileSystem, Result, Schema } from "effect"

/*
 * The room config: `.room/config.json`, committed.
 *
 * It is the contract a second machine inherits — the Linear project, the repo, the stage,
 * the ingress mode, the review policy. Secrets and local paths never live here; those are
 * in `~/.room/` and in the environment.
 *
 * `Schema` is the reader and the writer. A malformed file is `None`, which the caller turns
 * into "no room here", never into a half-config that looks authoritative.
 */

/** Where the config lives, relative to the repository root. */
export const CONFIG_PATH = ".room/config.json"

/** A room's committed configuration. */
export const RoomConfig = Schema.Struct({
  version: Schema.Literal(1),
  room: Schema.String,
  name: Schema.String,
  stage: Schema.String,
  project: Schema.Struct({
    kind: Schema.Literal("linear"),
    id: Schema.String,
    name: Schema.String,
    workspace: Schema.optionalKey(Schema.String),
  }),
  repo: Schema.Struct({
    owner: Schema.String,
    name: Schema.String,
    root: Schema.String,
  }),
  ingress: Schema.Struct({
    github: Schema.Literals(["forward", "poll"]),
    linear: Schema.Literals(["poll", "webhook"]),
  }),
  review: Schema.Struct({
    trigger: Schema.Literal("review_requested"),
    provider: Schema.String,
    model: Schema.String,
    slots: Schema.Finite,
  }),
  watch: Schema.optionalKey(
    Schema.Struct({
      label: Schema.String,
    }),
  ),
  worker: Schema.optionalKey(
    Schema.Struct({
      substrate: Schema.Literals(["hc", "rex"]),
    }),
  ),
  createdAt: Schema.String,
})

/** A room's configuration. */
export type RoomConfig = typeof RoomConfig.Type

/**
 * Read a config value, or `None` when it is absent or malformed.
 *
 * @param value - The parsed JSON, from a file or a boundary.
 * @returns Some(config) when the shape is complete, None otherwise.
 */
export const decodeConfig = (value: Schema.JsonObject): Result.Result<RoomConfig, string> => {
  const result = Schema.decodeUnknownResult(RoomConfig)(value)
  return Result.isSuccess(result)
    ? Result.succeed(result.success)
    : Result.fail("config does not match the room schema")
}

/**
 * Read a room config from disk.
 *
 * @param file - The absolute path to `.room/config.json`.
 * @returns Some(config) when the file exists and decodes, None otherwise.
 */
export const readConfig = (
  file: string,
): Effect.Effect<Result.Result<RoomConfig, string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return Result.fail("no room config")
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    return Schema.decodeResult(Schema.fromJsonString(RoomConfig))(text).pipe(
      Result.mapError(() => "config does not match the room schema"),
    )
  })

/**
 * Encode a config in the one shape the writer emits.
 *
 * @param config - The config to write.
 * @returns Pretty JSON with a trailing newline.
 */
export const encodeConfig = (config: RoomConfig): string => `${JSON.stringify(config, null, 2)}\n`
