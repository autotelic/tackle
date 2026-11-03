import { Clock, Console, Effect, Option, Path, Result, Runtime } from "effect"
import { Argument, CliError, Command, Flag } from "effect/cli"

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { jobOf } from "@autotelic/board"
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import {
  doctor,
  init,
  plan,
  renderBoard,
  renderChecks,
  renderPlan,
  startWorker,
  stopWorker,
  attachWorker,
} from "./commands.ts"
import { readConfig, type RoomConfig } from "./config.ts"
import { daemon, roomUrl } from "./daemon.ts"
import { seedRoom } from "./seed.ts"
import { linearWebhook, webhookCommand as webhookLine, webhookRegistration } from "./webhooks.ts"
import {
  followRoomSession,
  noteToRoom,
  openSessionFor,
  recentEntries,
  roomSessionView,
  submitToRoom,
} from "./session.ts"
import { findConfigPath, readIndex, roomsByActivity } from "./paths.ts"
import { RoomClient } from "./client.ts"
import { runReview } from "./review.ts"

/*
 * `room`, as an effect/cli program.
 *
 * The CLI is the thin door: resolve the root, call one function, print. Every decision lives
 * in the module behind it, so the daemon and the tests use the same code with no process in
 * between. `jig room` forwards here, which is why this file owns its own help and flags.
 */

const write = (text: string): Effect.Effect<void> =>
  Console.log(text.endsWith("\n") ? text.slice(0, -1) : text)

const cwdFlag = Flag.String("cwd").pipe(
  Flag.withDescription("Repository root (default: the current directory)."),
  Flag.optional,
)

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the machine-readable shape."),
  Flag.withDefault(false),
)

const rootOf = (cwd: Option.Option<string>): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    return path.resolve(Option.getOrUndefined(cwd) ?? process.cwd())
  })

/** Set the process code; a handler's return value is not an exit code. */
const exit = (code: number): Effect.Effect<void> =>
  Effect.sync(() => {
    process.exitCode = code
  })

const planCommand = Command.make("plan", { cwd: cwdFlag, json: jsonFlag }, (options) =>
  Effect.gen(function* () {
    const root = yield* rootOf(options.cwd)
    const value = yield* plan(root)
    yield* write(
      options.json
        ? JSON.stringify(value, null, 2)
        : renderPlan(value, yield* Clock.currentTimeMillis),
    )
  }),
).pipe(
  Command.withDescription("Read the repo, the token, and the rooms; print the init it would run."),
  Command.withShortDescription("Plan a room."),
)

const initCommand = Command.make(
  "init",
  {
    cwd: cwdFlag,
    room: Flag.String("room").pipe(Flag.withDescription("Room name, e.g. multi-season.")),
    project: Flag.String("linear-project").pipe(
      Flag.withDescription("Linear project id, from `linearis projects list`."),
    ),
    projectName: Flag.String("linear-name").pipe(
      Flag.withDescription("Linear project name, as a person would read it."),
    ),
    workspace: Flag.String("workspace").pipe(
      Flag.withDescription("Linear workspace slug, for the audit record."),
      Flag.optional,
    ),
    stage: Flag.String("stage").pipe(
      Flag.withDescription("Where this room runs (default: local/<login>)."),
      Flag.optional,
    ),
    label: Flag.String("label").pipe(
      Flag.withDescription(
        "The GitHub label that addresses this room (optional; review requests still work).",
      ),
      Flag.optional,
    ),
    linearUser: Flag.String("linear-user").pipe(
      Flag.withDescription("The Linear display name to treat as this person (optional)."),
      Flag.optional,
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("Rewrite an existing room.config.json."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const outcome = yield* Effect.result(
        init({
          cwd: root,
          name: options.room,
          projectId: options.project,
          projectName: options.projectName,
          workspace: Option.getOrUndefined(options.workspace),
          stage: Option.getOrUndefined(options.stage),
          label: Option.getOrUndefined(options.label),
          linearUser: Option.getOrUndefined(options.linearUser),
          force: options.force,
          now: yield* Clock.currentTimeMillis,
        }),
      )
      if (Result.isFailure(outcome)) {
        yield* write(outcome.failure)
        yield* exit(1)
        return
      }
      const result = outcome.success
      yield* write(
        [
          `room: ${result.config.room}`,
          `  config   ${result.path}`,
          `  stage    ${result.config.stage}`,
          `  roomd    ${
            result.configured
              ? `configured at ${roomUrl()}`
              : `not reachable at ${roomUrl()} (start it with \`jig room dev\`)`
          }`,
          "",
          "next",
          "  jig room dev",
          `  ${webhookLine(result.config)}`,
          "  jig room daemon",
          `  jig room session     the durable conversation (--say, --watch, --note)`,
          `  jig room webhook --create     register the webhook on a deployed room`,
        ].join("\n"),
      )
    }),
).pipe(
  Command.withDescription("Write room.config.json, register the room, and print the local loop."),
  Command.withShortDescription("Create a room here."),
)

const boardCommand = Command.make(
  "board",
  {
    cwd: cwdFlag,
    room: Flag.String("room").pipe(
      Flag.withDescription("A room name from the index (default: the room in this repository)."),
      Flag.optional,
    ),
    json: jsonFlag,
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const named = Option.getOrUndefined(options.room)
      let config: RoomConfig | undefined
      if (named === undefined) {
        config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
      } else {
        const index = yield* readIndex
        const entry = index.rooms.find((room) => room.name === named || room.room === named)
        config =
          entry === undefined
            ? undefined
            : Result.getOrUndefined(yield* readConfig(entry.configPath))
      }
      if (config === undefined) {
        yield* write("room board: no room here; run `jig room plan`")
        yield* exit(1)
        return
      }
      const board = Result.getOrUndefined(
        yield* Effect.tryPromise({
          try: () => new RoomClient(roomUrl(), config.room).board(),
          catch: () => Result.fail("room did not answer"),
        }).pipe(Effect.orElseSucceed(() => Result.fail("room did not answer"))),
      )
      if (options.json) {
        yield* write(
          JSON.stringify(
            board === undefined
              ? {
                  room: config.room,
                  address: config.room,
                  name: config.name,
                  stage: config.stage,
                  reachable: false,
                  // Without this, "nothing queued" and "the surface cannot reach roomd" look
                  // identical in the JSON a tool or a badge reads.
                  reason: `roomd not reachable at ${roomUrl()}`,
                }
              : { ...board, address: config.room, name: config.name, stage: config.stage },
            null,
            2,
          ),
        )
        return
      }
      const now = yield* Clock.currentTimeMillis
      yield* write(renderBoard({ config, board, now }))
    }),
).pipe(
  Command.withDescription("Render the room's board: jobs, chits, and who is present."),
  Command.withShortDescription("Show the board."),
)

const doctorCommand = Command.make("doctor", { cwd: cwdFlag }, (options) =>
  Effect.gen(function* () {
    const root = yield* rootOf(options.cwd)
    const checks = yield* doctor(root)
    yield* write(renderChecks(checks))
    yield* exit(checks.every((check) => check.ok) ? 0 : 1)
  }),
).pipe(
  Command.withDescription(
    "Prove the loop: config, identity, celld, pi, the GitHub forward, and the room.",
  ),
  Command.withShortDescription("Check the room."),
)

/** Resolve a room's config from this repository, or by name from the machine's index. */
const configFor = (root: string, named: string | undefined) =>
  Effect.gen(function* () {
    if (named === undefined) return Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
    const index = yield* readIndex
    const entry = index.rooms.find((room) => room.name === named || room.room === named)
    return entry === undefined
      ? undefined
      : Result.getOrUndefined(yield* readConfig(entry.configPath))
  })

const voidCommand = Command.make(
  "void",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("Job id from the board, for example pr:47:abc123."),
    ),
    cwd: cwdFlag,
    room: Flag.String("room").pipe(
      Flag.withDescription("A room name from the index (default: the room in this repository)."),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const config = yield* configFor(root, Option.getOrUndefined(options.room))
      if (config === undefined) {
        yield* write("room void: no room here; run `jig room plan`")
        yield* exit(1)
        return
      }
      const outcome = yield* Effect.tryPromise({
        try: () => new RoomClient(roomUrl(), config.room).voidJob(options.id),
        catch: (error) => String(error),
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (outcome === undefined) {
        yield* write("room void: roomd did not answer at " + roomUrl())
        yield* exit(1)
        return
      }
      yield* write(
        outcome.voided === 0
          ? "room void: no queued or claimed job " + options.id
          : "voided " + options.id + " (the row stays on the board)",
      )
    }),
).pipe(
  Command.withDescription("Void a queued or claimed job so no daemon runs it. The record stays."),
  Command.withShortDescription("Void a job."),
)

const sessionCommand = Command.make(
  "session",
  {
    cwd: cwdFlag,
    room: Flag.String("room").pipe(
      Flag.withDescription("A room name from the index (default: the room in this repository)."),
      Flag.optional,
    ),
    recent: Flag.Int("recent").pipe(
      Flag.withDescription("Read the last N entries instead of streaming them."),
      Flag.optional,
    ),
    json: jsonFlag,
    say: Flag.String("say").pipe(
      Flag.withDescription("Hand this text to the room's durable conversation as input."),
      Flag.optional,
    ),
    note: Flag.String("note").pipe(
      Flag.withDescription(
        "Record a fact as a write (kind): the model does not see it, the transcript does.",
      ),
      Flag.optional,
    ),
    data: Flag.String("data").pipe(
      Flag.withDescription("JSON payload for --note. Default {}."),
      Flag.optional,
    ),
    watch: Flag.Boolean("watch").pipe(
      Flag.withDescription("Follow the conversation and print new entries as JSON lines."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const config = yield* configFor(root, Option.getOrUndefined(options.room))
      if (config === undefined) {
        yield* write("room session: no room here; run `jig room plan`")
        yield* exit(1)
        return
      }
      const session = yield* Effect.tryPromise({
        try: () => openSessionFor(config),
        catch: (error) => String(error),
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (session === undefined) {
        yield* write("room session: could not open the conversation storage")
        yield* exit(1)
        return
      }
      const text = Option.getOrUndefined(options.say)
      if (text !== undefined) {
        const id = yield* Effect.tryPromise({
          try: () => submitToRoom({ session, text }),
          catch: (error) => String(error),
        }).pipe(Effect.orElseSucceed(() => undefined))
        yield* write(
          id === undefined ? "room session: the input was not admitted" : `admitted ${id}`,
        )
      }
      const kind = Option.getOrUndefined(options.note)
      if (kind !== undefined) {
        // The payload travels verbatim: a note is a string a person or an agent wrote, and the
        // view renders it as-is (session.ts unwraps the envelope). Re-encoding it here is how a
        // recorded note ended up double-quoted in the transcript.
        const data = { raw: Option.getOrUndefined(options.data) ?? "" }
        const id = yield* Effect.tryPromise({
          try: () => noteToRoom({ session, kind, data }),
          catch: (error) => String(error),
        }).pipe(Effect.orElseSucceed(() => undefined))
        yield* write(
          id === undefined ? "room session: the note was not recorded" : `recorded ${id}`,
        )
      }
      if (options.watch) {
        const stop = yield* Effect.tryPromise({
          try: () =>
            followRoomSession({
              session,
              onEntries: (entries) => {
                for (const entry of entries) {
                  process.stdout.write(
                    `${JSON.stringify({ session: session.id, id: entry.id, kind: entry.kind, text: entry.text })}\n`,
                  )
                }
              },
            }),
          catch: (error) => String(error),
        }).pipe(Effect.orElseSucceed(() => undefined))
        if (stop === undefined) {
          yield* write("room session: could not follow the conversation")
          yield* exit(1)
          return
        }
        yield* write(`following ${session.id} · ^C stops the client, not the conversation`)
        return yield* Effect.never
      }
      const limit = Option.getOrUndefined(options.recent)
      const entries =
        limit === undefined
          ? undefined
          : yield* Effect.tryPromise({
              try: () => recentEntries({ session, limit }),
              catch: (error) => String(error),
            }).pipe(Effect.orElseSucceed(() => undefined))
      const view = yield* Effect.tryPromise({
        try: () => roomSessionView(session),
        catch: (error) => String(error),
      }).pipe(Effect.orElseSucceed(() => undefined))
      if (options.json) {
        yield* write(
          `${JSON.stringify(
            entries === undefined
              ? (view ?? { id: session.id, busy: false, queued: 0 })
              : { view, entries },
            null,
            2,
          )}\n`,
        )
      } else if (entries !== undefined) {
        yield* write(
          entries
            .map((entry) => `${entry.kind.padEnd(14)} ${entry.text.replaceAll("\n", " ")}`)
            .join("\n"),
        )
      } else {
        yield* write(
          view === undefined
            ? `session ${session.id}`
            : `session ${view.id}${view.busy ? " · busy" : ""}${view.runFailure === undefined ? "" : ` · ${view.runFailure}`}`,
        )
      }
    }),
).pipe(
  Command.withDescription(
    "Read or drive the room's durable conversation: the session that survives the process.",
  ),
  Command.withShortDescription("The room's durable session."),
)

const listCommand = Command.make("list", { json: jsonFlag }, (options) =>
  Effect.gen(function* () {
    const rooms = yield* roomsByActivity
    if (options.json) {
      yield* write(JSON.stringify(rooms, null, 2))
      return
    }
    if (rooms.length === 0) {
      yield* write("no rooms yet — `jig room plan`")
      return
    }
    yield* write(
      rooms
        .map((room) => {
          const when = room.lastSeen === 0 ? "never" : new Date(room.lastSeen).toISOString()
          return `  ${room.name.padEnd(24)} ${room.stage.padEnd(18)} ${when}`
        })
        .join("\n"),
    )
  }),
).pipe(
  Command.withDescription("List rooms, most recently active first."),
  Command.withShortDescription("List rooms."),
)

const devCommand = Command.make(
  "dev",
  {
    port: Flag.String("port").pipe(
      Flag.withDescription("The celld Worker listener port (default 9876)."),
      Flag.withDefault("9876"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = fileURLToPath(new URL("..", import.meta.url))
      const esbuild = join(root, "node_modules", ".bin", "esbuild")
      const env = existsSync(esbuild) ? { ...process.env, CELLD_ESBUILD: esbuild } : process.env
      const url = `http://127.0.0.1:${options.port}`
      const child = spawn("celld", ["dev", "--port", options.port], {
        cwd: root,
        stdio: "inherit",
        env,
      })
      const missing = yield* Effect.tryPromise({
        try: () =>
          new Promise<boolean>((resolve) => {
            child.on("error", () => resolve(true))
            child.on("spawn", () => resolve(false))
          }),
        catch: () => true,
      }).pipe(Effect.orElseSucceed(() => true))
      if (missing) {
        yield* write("celld is not installed:\n  curl -fsSL https://celld.dev/install.sh | sh")
        yield* exit(1)
        return
      }
      // A room is up before it is useful: the committed config is the only thing that knows
      // the actor, the watched label, and the batch hold, and nothing copied it into the
      // ledger. An unseeded room accepts every webhook, queues nothing, and reads clean.
      const config = Result.getOrUndefined(yield* readConfig(findConfigPath(process.cwd())))
      if (config !== undefined) {
        // The address is not the name. A request to /r/<name>/… creates a second, unseeded
        // ledger that accepts events and queues nothing, which reads as a bug in the room.
        yield* write(
          "room address: " +
            config.room +
            '   (the name "' +
            config.name +
            '" is a label, not an address)',
        )
        const up = yield* Effect.tryPromise({
          try: async () => {
            const client = new RoomClient(url, config.room)
            for (let attempt = 0; attempt < 40; attempt++) {
              if ((await client.health().catch(() => undefined)) !== undefined) return true
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            return false
          },
          catch: () => false,
        }).pipe(Effect.orElseSucceed(() => false))
        const seeded = up
          ? yield* Effect.tryPromise({
              try: () => seedRoom({ config, url }),
              catch: () => Result.fail(`room not reachable at ${url}`),
            }).pipe(Effect.orElseSucceed(() => Result.fail(`room not reachable at ${url}`)))
          : Result.fail(`room did not answer at ${url}`)
        yield* write(
          Result.isSuccess(seeded)
            ? `room seeded: ${seeded.success}`
            : `room not seeded: ${seeded.failure} (webhooks will be accepted and go nowhere)`,
        )
        // Two silences this line exists to break: nothing arrives (no forward, no webhook), and
        // a job from a previous run is still claimable, so a daemon would run a stale review.
        const reachable = up
          ? yield* Effect.tryPromise({
              try: () => new RoomClient(url, config.room).board(),
              catch: () => Result.fail("room did not answer"),
            }).pipe(Effect.orElseSucceed(() => Result.fail("room did not answer")))
          : undefined
        const count = (state: string): number =>
          reachable !== undefined && Result.isSuccess(reachable)
            ? reachable.success.jobs.filter((job) => job.state === state).length
            : 0
        if (count("queued") + count("claimed") > 0) {
          yield* write(
            `jobs: ${String(count("queued"))} queued, ${String(count("claimed"))} claimed -- a daemon will run them; void one with ${"`room void <id>`"}`,
          )
        }
        yield* write(
          config.ingress.github === "forward"
            ? `ingress: github forward -- nothing arrives until you run ${"`room webhook | sh`"}`
            : `ingress: github webhook -- register it once with ${"`room webhook --create`"}`,
        )
        if (config.ingress.linear === "poll") {
          yield* write(
            `ingress: linear poll -- no poller is implemented; register Linear's webhook with ${"`room webhook`"}`,
          )
        }
      }
      const code = yield* Effect.tryPromise({
        try: () =>
          new Promise<number>((resolve) => child.on("exit", (value) => resolve(value ?? 1))),
        catch: () => 1,
      }).pipe(Effect.orElseSucceed(() => 1))
      yield* exit(code)
    }),
).pipe(
  Command.withDescription("Run the room locally with `celld dev`."),
  Command.withShortDescription("Run the room."),
)

const workCommand = Command.make(
  "work",
  {
    cwd: cwdFlag,
    pr: Flag.Int("pr").pipe(Flag.withDescription("Pull request number.")),
    kind: Flag.Literals("kind", ["fix", "review"]).pipe(
      Flag.withDescription("The kind of work the session is for."),
      Flag.withDefault("fix"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const result = yield* startWorker({ cwd: root, pr: options.pr, kind: options.kind }).pipe(
        Effect.result,
      )
      if (Result.isFailure(result)) {
        yield* write(result.failure)
        yield* exit(1)
        return
      }
      yield* write(
        `worker ${result.success.name} · ${result.success.address}\n  attach: jig room attach --name ${result.success.name}`,
      )
    }),
).pipe(
  Command.withDescription("Start an attachable worker session in its own worktree (herdr-core)."),
  Command.withShortDescription("Start a worker."),
)

const attachCommand = Command.make(
  "attach",
  {
    cwd: cwdFlag,
    name: Flag.String("name").pipe(Flag.withDescription("The worker name from `jig room board`.")),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const result = yield* attachWorker({ cwd: root, name: options.name }).pipe(Effect.result)
      if (Result.isFailure(result)) {
        yield* write(result.failure)
        yield* exit(1)
      }
    }),
).pipe(
  Command.withDescription("Attach to a worker session through herdr-core."),
  Command.withShortDescription("Attach to a worker."),
)

const stopCommand = Command.make(
  "stop",
  {
    cwd: cwdFlag,
    name: Flag.String("name").pipe(Flag.withDescription("The worker name from `jig room board`.")),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const result = yield* stopWorker({ cwd: root, name: options.name }).pipe(Effect.result)
      if (Result.isFailure(result)) {
        yield* write(result.failure)
        yield* exit(1)
        return
      }
      yield* write(`stopped ${result.success}`)
    }),
).pipe(
  Command.withDescription("Stop a worker: its app, database, terminals, and worktree."),
  Command.withShortDescription("Stop a worker."),
)

const daemonCommand = Command.make(
  "daemon",
  {
    cwd: cwdFlag,
    once: Flag.Boolean("once").pipe(
      Flag.withDescription("Claim and run one job, then exit."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
      if (config === undefined) {
        yield* write("room daemon: no room.config.json")
        yield* exit(1)
        return
      }
      yield* daemon({
        config,
        url: roomUrl(),
        once: options.once,
        log: (line) => process.stdout.write(`${line}\n`),
      }).pipe(
        Effect.orElseSucceed(() => {
          process.exitCode = 1
        }),
      )
    }),
).pipe(
  Command.withDescription("Claim review jobs and run them: presence, worktree, jig, Pi, one post."),
  Command.withShortDescription("Run the daemon."),
)

const reviewCommand = Command.make(
  "review",
  {
    cwd: cwdFlag,
    pr: Flag.Int("pr").pipe(Flag.withDescription("Pull request number.")),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Prepare the worktree and the prompt; do not call Pi or post."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
      if (config === undefined) {
        yield* write("room review: no room.config.json")
        yield* exit(1)
        return
      }
      const now = yield* Clock.currentTimeMillis
      const result = yield* Effect.tryPromise({
        try: () =>
          runReview({
            config,
            job: {
              id: jobOf({ pr: options.pr, sha: "manual" }),
              room: config.room,
              kind: "review",
              pr: options.pr,
              sha: "manual",
              state: "running",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            },
            dryRun: options.dryRun,
            log: (line) => process.stdout.write(`${line}\n`),
          }),
        catch: () => "review failed",
      }).pipe(
        Effect.orElseSucceed(() => ({
          ok: false,
          state: "failed" as const,
          note: "review failed",
        })),
      )
      yield* write(`${result.state}: ${result.note}`)
      yield* exit(result.ok ? 0 : 1)
    }),
).pipe(
  Command.withDescription("Run one review by hand, outside the queue."),
  Command.withShortDescription("Review one PR."),
)

const webhookCommand = Command.make(
  "webhook",
  {
    cwd: cwdFlag,
    create: Flag.Boolean("create").pipe(
      Flag.withDescription(
        "Register the room's GitHub webhook instead of forwarding: needs a public ROOM_URL.",
      ),
      Flag.withDefault(false),
    ),
    apply: Flag.Boolean("apply").pipe(
      Flag.withDescription("Run the gh api call. Without it, print the command."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const root = yield* rootOf(options.cwd)
      const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
      if (config === undefined) {
        yield* write("room webhook: no room.config.json")
        yield* exit(1)
        return
      }
      if (!options.create) {
        yield* write(webhookLine(config))
        const linear = linearWebhook({ config, url: roomUrl() })
        yield* write("\nLinear: point a webhook at " + linear + " with the linearis token")
        return
      }
      const registration = webhookRegistration({ config, url: roomUrl() })
      if (registration.kind === "local") {
        yield* write("room webhook: " + registration.reason)
        yield* exit(1)
        return
      }
      yield* write("gh " + registration.argv.join(" "))
      if (!options.apply) {
        yield* write("(add --apply to run it)")
        return
      }
      const outcome = yield* Effect.sync(() =>
        spawnSync("gh", [...registration.argv], { stdio: "inherit" }),
      )
      yield* exit(outcome.status ?? 1)
    }),
).pipe(
  Command.withDescription(
    "Forward this room's GitHub events locally, or register a real webhook (--create) on a deployed room.",
  ),
  Command.withShortDescription("Wire the room's webhooks."),
)

const cli = Command.make("room").pipe(
  Command.withDescription(
    "A project ledger, its daemon, and the review job. One room per Linear project, one stage per machine.",
  ),
  Command.withSubcommands([
    planCommand,
    initCommand,
    boardCommand,
    workCommand,
    attachCommand,
    stopCommand,
    doctorCommand,
    sessionCommand,
    voidCommand,
    listCommand,
    devCommand,
    daemonCommand,
    reviewCommand,
    webhookCommand,
  ]),
)

const program = Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.catchIf(CliError.isCliError, (error) =>
    Effect.sync(() => {
      process.exitCode = Runtime.getErrorExitCode(error) === 0 ? 0 : 2
    }),
  ),
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(program, { disableErrorReporting: true })
