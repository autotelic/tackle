import { Effect, FileSystem, Result, Schema } from "effect"
import { basename, join } from "node:path"
import type { RoomConfig } from "./config.ts"
import { stateDir } from "./paths.ts"

/*
 * Who is driving the room's durable conversation.
 *
 * The conversation became durable and multiplayer before the claim on it did. A board could say
 * `here togmund@macbook-pro.local` -- the daemon's presence -- and nothing about the Pi session
 * doing the work, so a second session had no way to ask "is someone already driving this" before
 * starting a rival run. Two sessions typing into one durable conversation is the same class of
 * bug as two sessions popping one stash.
 *
 * This is a claim, not liveness. A session id cannot be probed for existence, so recording a
 * heartbeat would have been a second answer to "is it alive" that is wrong exactly when the
 * process was killed; instead the file records who claimed the room and when, and taking it from
 * someone else is an explicit `--take-over`. The failure mode is a stale claim that one word
 * clears, which is the one this can be honest about.
 */

/** The session that claimed this room. */
export const Driver = Schema.Struct({
  /** The Pi session id (`$PI_SESSION_ID`), or `user@host` from a terminal. */
  sessionId: Schema.String,
  /** The checkout it is working in: a branch stack is what a session owns, not a room. */
  worktree: Schema.String,
  /** The machine that claimed it, so another machine's board does not read as a lie. */
  host: Schema.String,
  attachedAt: Schema.Finite,
})

/** The session that claimed this room. */
export type Driver = typeof Driver.Type

/**
 * Where the claim lives, beside the room's other local state.
 *
 * @param config - The room's committed config.
 * @returns The absolute path to `driver.json`.
 */
export const driverPath = (config: RoomConfig): string => join(stateDir(config), "driver.json")

/**
 * Read the claim, or nothing when there is none or it does not decode.
 *
 * @param config - The room's committed config.
 * @returns The driver, absent when nobody has claimed the room.
 */
export const readDriver = (
  config: RoomConfig,
): Effect.Effect<Driver | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = driverPath(config)
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return undefined
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    return Result.getOrUndefined(Schema.decodeResult(Schema.fromJsonString(Driver))(text))
  })

/**
 * Record who is driving.
 *
 * @param config - The room's committed config.
 * @param driver - The claim.
 * @returns Nothing; the write is the effect.
 */
export const writeDriver = (
  config: RoomConfig,
  driver: Driver,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.orElseSucceed(
      fs.makeDirectory(stateDir(config), { recursive: true }),
      () => undefined,
    )
    yield* Effect.orElseSucceed(
      fs.writeFileString(driverPath(config), `${JSON.stringify(driver, null, 2)}\n`),
      () => undefined,
    )
  })

/**
 * Stop driving. The guard for "only the driver may release" is the caller's, because it needs
 * the caller's identity; this only removes the claim.
 *
 * @param config - The room's committed config.
 * @returns Nothing; the removal is the effect.
 */
export const releaseDriver = (
  config: RoomConfig,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.orElseSucceed(fs.remove(driverPath(config)), () => undefined)
  })

/**
 * The name a worktree is read by: its last segment, so `seed-stack`, not the whole path.
 *
 * @param worktree - The absolute checkout path.
 * @returns The basename, or the path itself when it has none.
 */
export const worktreeName = (worktree: string): string => {
  const trimmed = worktree.replace(/\/+$/u, "")
  return basename(trimmed) || trimmed
}

/**
 * The checkout a claim records: the one the caller is in, not the one the room config is in.
 *
 * A room is bound to one directory, but a session can work in a linked worktree of the same
 * repository -- and two sessions in two worktrees that both recorded the room's root would read
 * as one identity on the board, which is the question the claim exists to answer.
 *
 * @param input - An explicit `--worktree`, git's top level from the caller's directory, and the
 *   room's root as the last resort.
 * @returns The path to record.
 */
export const claimedWorktree = (input: {
  readonly explicit: string | undefined
  readonly toplevel: string | undefined
  readonly root: string
}): string => input.explicit ?? input.toplevel ?? input.root

/**
 * Who is asking, as the claim and the guard name them.
 *
 * `$PI_SESSION_ID` is the session the host started, which is the id another session can look for
 * in the host's own session list. A plain terminal has no session id and claims as `user@host`,
 * which is the same shape as a daemon's presence id and honest about what it is.
 *
 * @param input - An explicit id, the environment, and the machine name.
 * @returns The caller's id.
 */
export const callerOf = (input: {
  readonly explicit: string | undefined
  readonly env: { readonly [key: string]: string | undefined }
  readonly machine: string
}): string =>
  input.explicit ?? input.env.PI_SESSION_ID ?? `${input.env.USER ?? "someone"}@${input.machine}`

/** How long ago a claim was made, in the few words a board line can afford. */
const ago = ({ at, now }: { readonly at: number; readonly now: number }): string => {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * How long a claim is believed without the session proving it is alive.
 *
 * There is no heartbeat, by design: a session id cannot be probed for existence, so a "still
 * alive" signal would have to be invented and would be wrong exactly when the process was
 * killed. An expiry is the honest alternative — a claim that nobody refreshed for half a day
 * stops being authoritative, and the board says so instead of rendering a dead session as the
 * room's driver. The guard is a speed bump against accidental double-driving, not a lock; two
 * sessions queueing into a durable conversation is safe, two sessions believing they own it is
 * what this prevents.
 */
export const DRIVER_TTL_MS = 12 * 60 * 60_000

/**
 * Whether a claim has expired.
 *
 * @param input - The claim and the instant.
 * @returns True when it is older than {@link DRIVER_TTL_MS}.
 */
export const staleDriver = (input: { readonly driver: Driver; readonly now: number }): boolean =>
  input.now - input.driver.attachedAt > DRIVER_TTL_MS

/**
 * The line a board and `session --status` show for the claim.
 *
 * @param input - The driver, when one exists, and the instant it is read.
 * @returns `driving <id> · <worktree> · <age>`, or who to ask about attaching.
 */
export const renderDriver = (input: {
  readonly driver: Driver | undefined
  readonly now: number
}): string =>
  input.driver === undefined
    ? "driving nobody (claim the room with `jig room session --attach`)"
    : `driving ${input.driver.sessionId} · ${worktreeName(input.driver.worktree)} · ${ago({ at: input.driver.attachedAt, now: input.now })}` +
      (staleDriver({ driver: input.driver, now: input.now }) ? " · stale" : "")

/**
 * Why this caller may not speak into the room, or undefined when it may.
 *
 * Reads and notes are not gated: a second session that needs to record a fact, or to read what
 * happened, is doing what the ledger is for. `--say` is gated because it asks the model for an
 * answer, and two answers to one conversation is the collision this exists to prevent.
 *
 * @param input - The claim, who is asking, the instant, and whether they asked to take over.
 * @returns A message naming the other driver, or nothing when the caller may speak.
 *
 * A sentence, not an `Option`: the two refusals share one message and one recovery, and the
 * tagged-failure form plumb prefers belongs to the refusal family as a whole, not here alone.
 */
export const sayRefusal = (input: {
  readonly driver: Driver | undefined
  readonly caller: string
  readonly now: number
  readonly takeOver: boolean
}): string | undefined => {
  if (input.takeOver) return undefined
  const driver = input.driver
  if (driver === undefined || driver.sessionId === input.caller) return undefined
  // An expired claim is not a collision: the session that made it has had half a day to say
  // otherwise, and refusing a live session because of a dead one is the failure a TTL prevents.
  if (staleDriver({ driver, now: input.now })) return undefined
  return (
    `this room is driven by ${driver.sessionId} (${worktreeName(driver.worktree)}), claimed ` +
    `${ago({ at: driver.attachedAt, now: input.now })}; the ledger cannot prove that session is gone.\n` +
    "  pass --take-over to speak anyway, or --note to record a fact without driving"
  )
}
