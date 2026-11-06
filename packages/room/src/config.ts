import { Effect, FileSystem, Result, Schema } from "effect"

/*
 * The room config: `room.config.json`, committed.
 *
 * It is the contract a second machine inherits — the Linear project, the repo, the stage,
 * the ingress mode, the review policy. Secrets and local paths never live here; those are
 * in `~/.room/` and in the environment.
 *
 * `Schema` is the reader and the writer. A malformed file is `None`, which the caller turns
 * into "no room here", never into a half-config that looks authoritative.
 */

/** Where the config lives, relative to the repository root. */
export const CONFIG_PATH = "room.config.json"

/** The pre-move location, read for compatibility and never written. */
export const LEGACY_CONFIG_PATH = ".room/config.json"

/**
 * A workstream with a Linear project behind it: the project id is the address.
 */
export const LinearProject = Schema.Struct({
  kind: Schema.Literal("linear"),
  id: Schema.String,
  name: Schema.String,
  workspace: Schema.optionalKey(Schema.String),
})

/**
 * A workstream addressed by a GitHub label, with no Linear project.
 *
 * `id` is the label, because the label is the address: it is what a PR carries and what a
 * webhook names. A room still needs one string for the ledger, the state directory, and the
 * index key, and inventing a placeholder there would make two label rooms look alike.
 */
export const LabelProject = Schema.Struct({
  kind: Schema.Literal("github"),
  id: Schema.String,
  name: Schema.String,
})

/** A room's committed configuration. */
export const RoomConfig = Schema.Struct({
  version: Schema.Literal(1),
  room: Schema.String,
  name: Schema.String,
  stage: Schema.String,
  project: Schema.Union([LinearProject, LabelProject]),
  repo: Schema.Struct({
    owner: Schema.String,
    name: Schema.String,
    root: Schema.String,
  }),
  ingress: Schema.Struct({
    github: Schema.Literals(["forward", "poll"]),
    /**
     * `none` is a label-addressed room: there is no project to poll, and a poller pointed at
     * one would either fail or, worse, pull a foreign project's issues into this ledger.
     */
    linear: Schema.Literals(["poll", "webhook", "none"]),
  }),
  review: Schema.Struct({
    trigger: Schema.Literals(["review_requested", "review_submitted", "review_comment"]),
    provider: Schema.String,
    model: Schema.String,
    slots: Schema.Finite,
  }),
  /**
   * The label that answers "is this PR this room's?" — used for both jobs on purpose.
   *
   * It addresses the room (a PR carrying it is `pr.ready`), and it scopes a review request
   * (a request names a person, so without it every request in the organisation lands in
   * whichever room watches them). Splitting these into `watch.label` and `review.label` was
   * considered and refused: two fields can drift, and the drift is silent in both directions
   * (a relabel for review routing stops the room seeing its own PRs, or the reverse). One field
   * meaning "this PR belongs to this room" is easier to keep true, and when it is wrong the
   * board counts the delivery as `unrouted` instead of hiding it.
   */
  watch: Schema.optionalKey(
    Schema.Struct({
      label: Schema.String,
    }),
  ),
  worker: Schema.optionalKey(
    Schema.Struct({
      substrate: Schema.Literals(["hc", "rex"]),
      /**
       * Which Rex session a worker opens as a tab. Absent: a session of its own, which is the
       * safe default — a tab in somebody else's session is a placement decision, not a launch.
       */
      rex: Schema.optionalKey(
        Schema.Struct({
          session: Schema.optionalKey(Schema.String),
        }),
      ),
      app: Schema.optionalKey(
        Schema.Struct({
          setup: Schema.optionalKey(Schema.String),
          up: Schema.String,
          down: Schema.optionalKey(Schema.String),
          health: Schema.optionalKey(Schema.String),
          database: Schema.optionalKey(
            Schema.Struct({
              create: Schema.String,
              drop: Schema.String,
            }),
          ),
          env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
    }),
  ),
  linearUser: Schema.optionalKey(Schema.String),
  /** How long a sweep on one PR is held before it is delivered as one message. Default 30s. */
  batchMs: Schema.optionalKey(Schema.Finite),
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
 * @param file - The absolute path to `room.config.json`.
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
