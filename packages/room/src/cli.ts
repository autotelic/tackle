import { Console, Effect, Option, Path, Result, Runtime } from "effect"
import { CliError, Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { jobOf } from "@autotelic/board"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  doctor,
  init,
  plan,
  renderBoard,
  renderChecks,
  renderPlan,
  webhookCommand as webhookLine,
} from "./commands.ts"
import { readConfig, type RoomConfig } from "./config.ts"
import { daemon, roomUrl } from "./daemon.ts"
import { configPathOf, readIndex, roomsByActivity } from "./paths.ts"
import { RoomClient, type Board } from "./client.ts"
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
    yield* write(options.json ? JSON.stringify(value, null, 2) : renderPlan(value))
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
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("Rewrite an existing .room/config.json."),
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
          force: options.force,
          now: Date.now(),
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
        ].join("\n"),
      )
    }),
).pipe(
  Command.withDescription("Write .room/config.json, register the room, and print the local loop."),
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
        config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
      } else {
        const index = yield* readIndex()
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
      const board = Option.getOrUndefined(
        yield* Effect.tryPromise({
          try: () => new RoomClient(roomUrl(), config.room).board(),
          catch: () => Option.none<Board>(),
        }).pipe(Effect.orElseSucceed(() => Option.none<Board>())),
      )
      if (options.json) {
        yield* write(
          JSON.stringify(
            board === undefined
              ? { room: config.room, name: config.name, stage: config.stage, reachable: false }
              : { ...board, name: config.name, stage: config.stage },
            null,
            2,
          ),
        )
        return
      }
      yield* write(renderBoard({ config, board }))
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
    yield* exit(checks.length > 0 && checks.every((check) => check.ok) ? 0 : 1)
  }),
).pipe(
  Command.withDescription(
    "Prove the loop: config, identity, celld, the GitHub forward, and the room.",
  ),
  Command.withShortDescription("Check the room."),
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
      const result = yield* Effect.sync(() =>
        spawnSync("celld", ["dev", "--port", options.port], { cwd: root, stdio: "inherit" }),
      )
      if (result.error !== undefined) {
        yield* write("celld is not installed:\n  curl -fsSL https://celld.dev/install.sh | sh")
        yield* exit(1)
        return
      }
      yield* exit(result.status ?? 1)
    }),
).pipe(
  Command.withDescription("Run the room locally with `celld dev`."),
  Command.withShortDescription("Run the room."),
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
      const config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
      if (config === undefined) {
        yield* write("room daemon: no .room/config.json")
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
      const config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
      if (config === undefined) {
        yield* write("room review: no .room/config.json")
        yield* exit(1)
        return
      }
      const now = Date.now()
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
        catch: () => "review failed" as const,
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

const webhookCommand = Command.make("webhook", { cwd: cwdFlag }, (options) =>
  Effect.gen(function* () {
    const root = yield* rootOf(options.cwd)
    const config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
    if (config === undefined) {
      yield* write("room webhook: no .room/config.json")
      yield* exit(1)
      return
    }
    yield* write(webhookLine(config))
  }),
).pipe(
  Command.withDescription("Print the `gh webhook forward` command for this room."),
  Command.withShortDescription("Print the forward command."),
)

const cli = Command.make("room").pipe(
  Command.withDescription(
    "A project ledger, its daemon, and the review job. One room per Linear project, one stage per machine.",
  ),
  Command.withSubcommands([
    planCommand,
    initCommand,
    boardCommand,
    doctorCommand,
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
