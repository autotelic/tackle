import { Effect, FileSystem, Result, Schema } from "effect"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { RoomConfig } from "./config.ts"

/*
 * Where the room keeps what is not committed.
 *
 * `~/.room/<login>/<projectId>/` is the whole namespace. Two people on one machine cannot
 * collide, two checkouts of one repo cannot collide, and a second room for the same project
 * at another stage is a sibling directory. The committed half is `room.config.json`; the
 * rest is local state, worktrees, and job transcripts.
 */

/** The root of all local room state. */
export const roomHome = (): string => process.env.ROOM_HOME ?? join(homedir(), ".room")

/**
 * The state directory for one room.
 *
 * @param config - The room's committed config.
 * @returns `~/.room/<login>/<projectId>`.
 */
export const stateDir = (config: RoomConfig): string =>
  join(roomHome(), config.stage.replace(/^local\//, ""), config.project.id)

/**
 * The room's SQLite file.
 *
 * @param config - The room's committed config.
 * @returns The absolute database path.
 */
export const databasePath = (config: RoomConfig): string => join(stateDir(config), "room.sqlite")

/**
 * Where review worktrees are created.
 *
 * @param config - The room's committed config.
 * @returns The absolute worktree root.
 */
export const worktreeRoot = (config: RoomConfig): string => join(stateDir(config), "wt")

/**
 * Where a review job's Pi session is stored.
 *
 * @param config - The room's committed config.
 * @returns The absolute jobs root.
 */
export const jobsRoot = (config: RoomConfig): string => join(stateDir(config), "jobs")

/** The index of rooms on this machine. */
export const indexOfRooms = (): string => join(roomHome(), "index.json")

/** One room, as the picker reads it. */
export const RoomIndexEntry = Schema.Struct({
  room: Schema.String,
  name: Schema.String,
  projectId: Schema.String,
  stage: Schema.String,
  configPath: Schema.String,
  lastSeen: Schema.Finite,
})

/** One room, as the picker reads it. */
export type RoomIndexEntry = typeof RoomIndexEntry.Type

const RoomIndex = Schema.Struct({
  version: Schema.Literal(1),
  rooms: Schema.Array(RoomIndexEntry),
})

type RoomIndex = typeof RoomIndex.Type

const EMPTY: RoomIndex = { version: 1, rooms: [] }

/**
 * Read the index; a malformed file is an empty index, never a failed command.
 *
 * @returns The rooms recorded on this machine.
 */
export const readIndex: Effect.Effect<RoomIndex, never, FileSystem.FileSystem> = Effect.gen(
  function* () {
    const fs = yield* FileSystem.FileSystem
    const file = indexOfRooms()
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return EMPTY
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    const result = Schema.decodeResult(Schema.fromJsonString(RoomIndex))(text)
    return Result.isSuccess(result) ? result.success : EMPTY
  },
)

/**
 * Record or refresh one room. Sorted by activity when read, so the picker is honest.
 *
 * @param entry - The room to record.
 * @returns Nothing; the write is the effect.
 */
export const recordRoom = (
  entry: RoomIndexEntry,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const current = yield* readIndex
    const rooms = current.rooms.filter((room) => room.room !== entry.room)
    const next: RoomIndex = { version: 1, rooms: [...rooms, entry] }
    yield* Effect.orElseSucceed(fs.makeDirectory(roomHome(), { recursive: true }), () => undefined)
    yield* Effect.orElseSucceed(
      fs.writeFileString(indexOfRooms(), `${JSON.stringify(next, null, 2)}\n`),
      () => undefined,
    )
  })

/**
 * Active rooms first. A room is "active" when something touched it recently.
 *
 * @returns The index, newest first.
 */
export const roomsByActivity: Effect.Effect<
  ReadonlyArray<RoomIndexEntry>,
  never,
  FileSystem.FileSystem
> = readIndex.pipe(
  Effect.map((index) => [...index.rooms].sort((left, right) => right.lastSeen - left.lastSeen)),
)

/**
 * The committed config path for a repository root.
 *
 * @param root - The repository root.
 * @returns `<root>/room.config.json`.
 */
export const configPathOf = (root: string): string => join(root, "room.config.json")

/**
 * The pre-move config path, read for compatibility.
 *
 * @deprecated Use {@link configPathOf}; this path is read only for older rooms.
 * @param root - The repository root.
 * @returns `<root>/.room/config.json`.
 */
export const legacyConfigPathOf = (root: string): string => join(root, ".room", "config.json")

/**
 * The config a repository actually has: the root file, else the earlier one, else the new
 * path (so `init` has somewhere to write).
 *
 * @param root - The repository root.
 * @returns The path to read, or the path `init` would write.
 */
export const findConfigPath = (root: string): string =>
  existsSync(configPathOf(root))
    ? configPathOf(root)
    : existsSync(legacyConfigPathOf(root))
      ? legacyConfigPathOf(root)
      : configPathOf(root)

/**
 * The state directory, created if absent.
 *
 * @param config - The room's committed config.
 * @returns Nothing; the directories are the effect.
 */
export const ensureState = (
  config: RoomConfig,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    for (const dir of [stateDir(config), worktreeRoot(config), jobsRoot(config)]) {
      yield* Effect.orElseSucceed(fs.makeDirectory(dir, { recursive: true }), () => undefined)
    }
  })
