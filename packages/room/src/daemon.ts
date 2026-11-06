import { actorOf, hostOf } from "@autotelic/board"
import { Data, Effect, Predicate, Result } from "effect"

import { hostname } from "node:os"
import type { RoomConfig } from "./config.ts"
import { seedRoom } from "./seed.ts"
import { openSessionFor, submitToRoom } from "./session.ts"
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

/**
 * Whether this process should hand itself to Node's watcher instead of running the loop.
 *
 * `--watch` restarts the process when any imported file changes, which is the dev loop for
 * daemon.ts and everything it pulls in (review.ts, session.ts). A re-exec rather than an
 * in-process watcher: the loop holds nothing worth preserving, and a fresh process is the
 * honest restart -- an interrupted job lands back on the queue when its claim expires.
 *
 * The marker is an environment variable, not `process.execArgv.includes("--watch")`: Node
 * strips its own exec arguments for the watched child (they arrive empty), so that check passed
 * in the parent, failed in the child, and every watcher spawned another. The env var is the one
 * thing that survives the re-exec.
 *
 * @param input - The flag and whether this process is already the watched copy.
 * @returns True when the caller should spawn the watched copy and exit.
 */
export const wantsWatcher: Predicate.Predicate<{
  readonly watch: boolean
  readonly watched: boolean
}> = (input) => input.watch && !input.watched

/**
 * Run the room's daemon.
 *
 * @param options - The room, the URL, whether to run one job, and a logger.
 * @returns An effect that runs until interrupted.
 */
export const daemon = (options: DaemonOptions): Effect.Effect<void, DaemonError> =>
  Effect.gen(function* () {
    const client = new RoomClient(options.url, options.config.room)
    const log = options.log
    // Refuse before anything else. A daemon started without a room server retried a fetch that
    // could never succeed -- one line every two seconds -- and buried the instruction that says
    // what to do (`jig room dev`). A server that dies later is a different case: the loop below
    // keeps trying, because a restart is something to wait for, not to give up on.
    const reachable = yield* Effect.tryPromise({
      try: () => client.health(),
      catch: (error) => new DaemonError({ message: String(error) }),
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!reachable) {
      const start = "jig room dev"
      return yield* new DaemonError({
        message: `no room server at ${options.url} -- run \`${start}\` first`,
      })
    }
    const login = yield* Effect.sync(authLogin)
    if (Result.isFailure(login)) {
      return yield* new DaemonError({ message: login.failure })
    }
    const host = hostOf({ login: login.success, hostname: hostname() })
    const actor = actorOf(login.success)
    // One line per distinct failure, not one per attempt: three lines a second about a server
    // that is down is not a log, it is a wall, and the line that answers it scrolls away.
    let lastFailure = ""
    const failed = (tag: string, text: string): void => {
      const line = `${tag}: ${text}`
      if (line === lastFailure) return
      lastFailure = line
      log(line)
    }
    const recovered = (): void => {
      lastFailure = ""
    }
    // The room's conversation, opened where the daemon runs: delivery is a submit, and the
    // library owns resume, queueing, and single-writer admission.
    const session = yield* Effect.tryPromise({
      try: () => openSessionFor(options.config),
      catch: (error) => new DaemonError({ message: String(error) }),
    }).pipe(Effect.orElseSucceed(() => undefined))
    log(
      session === undefined
        ? "session: could not open the room's durable conversation"
        : `session: ${session.id} open at ${options.config.room}`,
    )

    // The ledger starts empty on every fresh celld, and the committed config is the only
    // place the actor, the label, and the batch hold are written down.
    const seeded = yield* Effect.tryPromise({
      try: () => seedRoom({ config: options.config, url: options.url }),
      catch: () => Result.fail("room not reachable"),
    }).pipe(Effect.orElseSucceed(() => Result.fail("room not reachable")))
    log(
      Result.isSuccess(seeded)
        ? `seeded ${seeded.success}`
        : `seed: ${seeded.failure} -- webhooks are accepted and go nowhere until the room is up`,
    )

    const beat = Effect.tryPromise({
      try: () => client.beat(host, actor, 60_000),
      catch: (error) => new DaemonError({ message: String(error) }),
    }).pipe(
      Effect.tap(() => Effect.sync(recovered)),
      Effect.catch((error) => Effect.sync(() => failed("presence", error.message))),
    )

    const work = Effect.gen(function* () {
      const job = yield* Effect.tryPromise({
        try: () => client.claim(host),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      if (job === null || job === undefined) return
      yield* Effect.tryPromise({
        try: () => client.start(job.id),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      log(`review ${job.id}`)
      const result = yield* Effect.tryPromise({
        try: () => runReview({ config: options.config, job, dryRun: false, prepare: false, log }),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      yield* Effect.tryPromise({
        try: () =>
          client.finish(job.id, result.state === "posted" ? "done" : result.state, result.note),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      log(`  ${result.state}: ${result.note}`)
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          failed("  failed", error instanceof Error ? error.message : String(error)),
        ),
      ),
    )

    // Delivery, not a wake: the conversation is durable, so a turn is an input. The library
    // queues it behind a running answer (follow-up) and starts the run when it is idle, which
    // is the admission rule the room used to approximate with a heartbeat and a spawn.
    const deliver = Effect.gen(function* () {
      if (session === undefined) return
      const inbox = yield* Effect.tryPromise({
        try: () => client.inbox(0),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      const turns = inbox.items.filter((item) => item.kind === "turn")
      if (turns.length === 0) return
      for (const turn of turns) {
        yield* Effect.tryPromise({
          try: () => submitToRoom({ session, text: turn.text }),
          catch: (error) => new DaemonError({ message: String(error) }),
        })
      }
      yield* Effect.tryPromise({
        try: () => client.ack(turns.map((turn) => turn.seq)),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      recovered()
      log(`delivered ${String(turns.length)} turn(s) to session ${session.id}`)
    }).pipe(Effect.catch((error) => Effect.sync(() => failed("deliver", error.message))))

    yield* Effect.forkChild(Effect.forever(Effect.flatMap(beat, () => Effect.sleep("20 seconds"))))

    if (options.once) {
      yield* deliver
      yield* work
      return
    }

    log(`roomd ${options.config.room} → ${options.url} (${host})`)
    return yield* Effect.forever(
      Effect.flatMap(deliver, () => Effect.flatMap(work, () => Effect.sleep("2 seconds"))),
    )
  })
