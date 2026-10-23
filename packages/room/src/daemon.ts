import { actorOf, hostOf } from "@autotelic/board"
import { Data, Effect, Result } from "effect"
import { hostname } from "node:os"
import type { RoomConfig } from "./config.ts"
import { authLogin } from "./gh.ts"
import { RoomClient } from "./client.ts"
import { runReview } from "./review.ts"

/*
 * roomd.
 *
 * The room cannot start a process; this daemon can. It is the only long-lived thing on the
 * machine: it beats presence, claims one job at a time, and runs a review in its own
 * worktree. Closing the TUI does not stop it, which is why a review can arrive while nobody
 * is looking at a session.
 *
 * The loop is Effect, not a `setInterval`: the heartbeat is a forked effect, the work is
 * sequential by construction, and the whole thing stops when the scope does.
 */

/** What the daemon can fail with. */
export class DaemonError extends Data.TaggedError("DaemonError")<{
  readonly message: string
}> {}

/** What a daemon needs to start. */
export interface DaemonOptions {
  readonly config: RoomConfig
  readonly url: string
  readonly once: boolean
  readonly log: (line: string) => void
}

const DEFAULT_URL = "http://127.0.0.1:9876"

/** The room URL this machine talks to. */
export const roomUrl = (): string => process.env.ROOM_URL ?? DEFAULT_URL

const failure = (error: unknown): DaemonError =>
  new DaemonError({ message: error instanceof Error ? error.message : String(error) })

/**
 * Run the room's daemon.
 *
 * @param options - The room, the URL, whether to run one job, and a logger.
 * @returns An effect that runs until interrupted.
 */
export const daemon = (options: DaemonOptions): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    const login = yield* Effect.sync(authLogin)
    if (Result.isFailure(login)) {
      return yield* Effect.fail(new DaemonError({ message: login.failure }))
    }
    const host = hostOf({ login: login.success, hostname: hostname() })
    const actor = actorOf(login.success)
    const client = new RoomClient(options.url, options.config.room)
    const log = options.log

    const beat = Effect.tryPromise({
      try: () => client.beat(host, actor, 60_000),
      catch: failure,
    }).pipe(Effect.catch(() => Effect.void))

    const work = Effect.gen(function* () {
      const job = yield* Effect.tryPromise({
        try: () => client.claim(host),
        catch: failure,
      })
      if (job === null) return
      yield* Effect.tryPromise({ try: () => client.start(job.id), catch: failure })
      log(`review ${job.id}`)
      const result = yield* Effect.tryPromise({
        try: () => runReview({ config: options.config, job, dryRun: false, log }),
        catch: failure,
      })
      yield* Effect.tryPromise({
        try: () =>
          client.finish(job.id, result.state === "posted" ? "done" : result.state, result.note),
        catch: failure,
      })
      log(`  ${result.state}: ${result.note}`)
    }).pipe(Effect.catch((error) => Effect.sync(() => log(`  failed: ${error.message}`))))

    yield* Effect.forkChild(Effect.forever(Effect.flatMap(beat, () => Effect.sleep("20 seconds"))))

    if (options.once) {
      yield* work
      return
    }

    log(`roomd ${options.config.room} → ${options.url} (${host})`)
    return yield* Effect.forever(Effect.flatMap(work, () => Effect.sleep("2 seconds")))
  })
