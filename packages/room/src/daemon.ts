import { actorOf, hostOf } from "@autotelic/board"
import { Clock, Data, Effect, Result } from "effect"
import { spawn } from "node:child_process"
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

/** Resume a closed session headlessly; Pi appends to the same transcript. */
const wakeSession = (input: {
  readonly cwd: string
  readonly session: string
  readonly text: string
}): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(
      "pi",
      ["-p", "--session", input.session, "--name", "room wake", input.text],
      { cwd: input.cwd, stdio: "ignore" },
    )
    child.on("error", () => resolve(127))
    child.on("close", (code) => resolve(code ?? 1))
  })

/** The room URL this machine talks to. */
export const roomUrl = (): string => process.env.ROOM_URL ?? DEFAULT_URL

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
      return yield* new DaemonError({ message: login.failure })
    }
    const host = hostOf({ login: login.success, hostname: hostname() })
    const actor = actorOf(login.success)
    const client = new RoomClient(options.url, options.config.room)
    const log = options.log

    const beat = Effect.tryPromise({
      try: () => client.beat(host, actor, 60_000),
      catch: (error) => new DaemonError({ message: String(error) }),
    }).pipe(Effect.catch((error) => Effect.sync(() => log(`presence: ${error.message}`))))

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
        try: () => runReview({ config: options.config, job, dryRun: false, log }),
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
          log(`  failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      ),
    )

    let lastWake = 0

    const wake = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (now - lastWake < 60_000) return
      const session = yield* Effect.tryPromise({
        try: () => client.session(),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      if (!session.active || session.id === null) return
      const inbox = yield* Effect.tryPromise({
        try: () => client.inbox(0),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      const turns = inbox.items.filter((item) => item.kind === "turn")
      if (turns.length === 0) return
      lastWake = now
      log(`wake ${session.id}`)
      const code = yield* Effect.tryPromise({
        try: () =>
          wakeSession({
            cwd: options.config.repo.root,
            session: session.id === null ? "" : session.id,
            text: turns.map((item) => item.text).join("\n\n---\n\n"),
          }),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
      if (code !== 0) {
        log(`wake failed: ${code}`)
        return
      }
      yield* Effect.tryPromise({
        try: () => client.ack(turns.map((item) => item.seq)),
        catch: (error) => new DaemonError({ message: String(error) }),
      })
    }).pipe(Effect.catch((error) => Effect.sync(() => log(`wake: ${error.message}`))))

    yield* Effect.forkChild(Effect.forever(Effect.flatMap(beat, () => Effect.sleep("20 seconds"))))

    if (options.once) {
      yield* wake
      yield* work
      return
    }

    log(`roomd ${options.config.room} → ${options.url} (${host})`)
    return yield* Effect.forever(
      Effect.flatMap(wake, () => Effect.flatMap(work, () => Effect.sleep("2 seconds"))),
    )
  })
