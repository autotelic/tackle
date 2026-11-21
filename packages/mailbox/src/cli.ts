import { Console, Data, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { appendTurn } from "./append.ts"
import { exportDirectory } from "./export.ts"
import { parseLog, serializeLog } from "./log.ts"
import { renderLog, renderTurn, verifyLog } from "./render.ts"
import { VERSION } from "./version.ts"

class MailboxError extends Data.TaggedError("MailboxError")<{ readonly detail: string }> {}

const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, MailboxError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new MailboxError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  })

const report = <A>(effect: Effect.Effect<A, MailboxError>): Effect.Effect<void> =>
  effect.pipe(
    Effect.catch((error) =>
      Console.error(`mailbox: ${error.detail}`).pipe(
        Effect.andThen(
          Effect.sync(() => {
            process.exitCode = 1
          }),
        ),
      ),
    ),
    Effect.asVoid,
  )

const readFiles = async (dir: string): Promise<ReadonlyMap<string, string>> => {
  const files = new Map<string, string>()
  for (const name of (await readdir(dir)).sort()) {
    if (!name.endsWith(".md")) continue
    files.set(name, await readFile(join(dir, name), "utf8"))
  }
  return files
}

const exportCommand = Command.make(
  "export",
  {
    dir: Flag.String("dir").pipe(
      Flag.withDescription("Thread directory of NNNN-*.md turns (default: the current directory)."),
      Flag.withDefault("."),
    ),
    out: Flag.String("out").pipe(
      Flag.withDescription("Log path to write, JSONL (default: log.jsonl)."),
      Flag.withDefault("log.jsonl"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      // Re-exporting an existing log must not move its backfill timestamp: the header records
      // when the history was first admitted, not when it was last re-read.
      const previous = yield* attempt(async () => {
        try {
          return parseLog(await readFile(options.out, "utf8")).backfill
        } catch {
          return undefined
        }
      })
      const log = yield* attempt(() =>
        exportDirectory(options.dir, previous?.at === undefined ? {} : { at: previous.at }),
      )
      yield* attempt(() => writeFile(options.out, serializeLog(log), "utf8"))
      yield* Console.log(`exported ${log.turns.length} turns to ${options.out}`)
    }).pipe(report),
).pipe(
  Command.withDescription(
    "Bootstrap a log from a directory of markdown turns. Runs once, before the wire; live turns arrive through send.",
  ),
  Command.withShortDescription("Backfill a log from markdown turns."),
)

const renderCommand = Command.make(
  "render",
  {
    log: Flag.String("log").pipe(Flag.withDescription("Log to read, JSONL.")),
    out: Flag.String("out").pipe(Flag.withDescription("Directory to write the turn files into.")),
  },
  (options) =>
    Effect.gen(function* () {
      const log = yield* attempt(async () => parseLog(await readFile(options.log, "utf8")))
      const rendered = renderLog(log)
      yield* attempt(async () => {
        await mkdir(options.out, { recursive: true })
        for (const [path, body] of rendered) await writeFile(join(options.out, path), body, "utf8")
      })
      yield* Console.log(`rendered ${rendered.size} turns into ${options.out}`)
    }).pipe(report),
).pipe(
  Command.withDescription("Render the log into turn files, deterministically and idempotently."),
  Command.withShortDescription("Render the log into markdown."),
)

const writeCommand = Command.make(
  "write",
  {
    log: Flag.String("log").pipe(Flag.withDescription("Log to append the turn to, JSONL.")),
    turn: Flag.String("turn").pipe(
      Flag.withDescription("Turn file to render (the path recorded in the log)."),
    ),
    body: Flag.String("body").pipe(Flag.withDescription("File holding the turn's markdown body.")),
    sender: Flag.String("sender").pipe(
      Flag.withDescription("Sender label or DID (default: read from the heading)."),
      Flag.withDefault(""),
    ),
    reply: Flag.String("reply").pipe(
      Flag.withDescription("TID this turn answers (default: the last turn)."),
      Flag.withDefault(""),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const body = yield* attempt(() => readFile(options.body, "utf8"))
      const current = yield* attempt(async () => {
        try {
          return parseLog(await readFile(options.log, "utf8"))
        } catch (cause) {
          if ((cause as { code?: string }).code === "ENOENT") return { turns: [] }
          throw cause
        }
      })
      const { log, turn } = appendTurn(current, {
        path: options.turn,
        body,
        ...(options.sender === "" ? {} : { sender: options.sender }),
        ...(options.reply === "" ? {} : { replyTo: options.reply }),
      })
      yield* attempt(() => writeFile(options.log, serializeLog(log), "utf8"))
      // A bare filename belongs beside the log, not in whatever directory the caller stood in.
      // Writing to the cwd and then verifying the thread directory is the failure that proves it.
      const turnPath = options.turn.includes("/")
        ? options.turn
        : join(dirname(options.log), options.turn)
      // Write what render would write, not the body verbatim: verify compares bytes, and a body
      // without a trailing newline would pass the append and fail the projection.
      yield* attempt(() => writeFile(turnPath, renderTurn(turn), "utf8"))
      yield* Console.log(`wrote ${turn.path} seq=${turn.seq} tid=${turn.tid}`)
    }).pipe(report),
).pipe(
  Command.withDescription(
    "Append a turn: assign the next seq and a TID, check the reply edge, write the log and render the file.",
  ),
  Command.withShortDescription("Append and render one turn."),
)

const verifyCommand = Command.make(
  "verify",
  {
    log: Flag.String("log").pipe(Flag.withDescription("Log the files must agree with, JSONL.")),
    dir: Flag.String("dir").pipe(
      Flag.withDescription("Thread directory holding the rendered turn files."),
      Flag.withDefault("."),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const log = yield* attempt(async () => parseLog(await readFile(options.log, "utf8")))
      const files = yield* attempt(() => readFiles(options.dir))
      const drift = verifyLog(log, files)
      if (drift.length === 0) {
        yield* Console.log(`verified ${log.turns.length} turns in ${options.dir}`)
        return
      }
      for (const entry of drift) yield* Console.error(`${entry.kind}\t${entry.path}`)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
    }).pipe(report),
).pipe(
  Command.withDescription(
    "Regenerate the projection and diff it against the files. Missing, extra, or differing turns fail.",
  ),
  Command.withShortDescription("Fail when the files disagree with the log."),
)

const cli = Command.make("mailbox").pipe(
  Command.withDescription(
    "The mail seam: a canonical turn log, a deterministic markdown projection, and the fence that will host it.",
  ),
  Command.withSubcommands([exportCommand, writeCommand, renderCommand, verifyCommand]),
)

const mailboxProgram = Command.run(cli, { version: VERSION }).pipe(
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(mailboxProgram, { disableErrorReporting: true })
