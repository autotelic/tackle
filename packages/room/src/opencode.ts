import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { Option, Result, Schema } from "effect"

/*
 * The room as an OpenCode plugin, for both of its plugin APIs.
 *
 * Same rule as jig's OpenCode plugin and the room's Pi extension: this file owns no
 * projection. It shells out to the `room` binary and hands the model the bytes a person's
 * terminal shows, so the durable conversation, the plan, and the board read the same from
 * every host.
 *
 * Two shapes, one module, because two hosts are installed on the machines this runs on:
 *
 *   default.id + default.server()   opencode 1.x  (`opencode --version` 1.19 here)
 *   default.id + default.setup()    opencode2    (V2 API, `@opencode/plugin` 2.x)
 *
 * A V2-only plugin fails to load on a 1.x host with "must default export an object with
 * server()"; a V1-only plugin never reaches the V2 tool transform. Export both.
 *
 * How a host *finds* the module differs too, and it is not interchangeable: opencode 1.x reads
 * plugin FILES (`.opencode/plugins/` or `~/.config/opencode/plugins/`) and ignores the `plugin`
 * array in `opencode.json`; opencode 2 reads that array. Verified on 1.19: the same build in
 * `.opencode/plugins/room.js` registers all five tools, while the array alone registers none.
 */

const run = promisify(execFile)

/** The package root: the directory above `src/` (source) or `dist/` (built). */
const packageRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), "..")

/** The first `name` on PATH, if any. */
const onPath = (name: string): Option.Option<string> => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return Option.some(candidate)
  }
  return Option.none()
}

/** How to launch the room CLI: a command and its leading args. */
export interface Launcher {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/** The facts the fallback decision reads, injected so it can be tested without spawning. */
export interface LaunchEnvironment {
  readonly override: string | undefined
  readonly onPath: (name: string) => Option.Option<string>
  readonly execPath: string
  readonly exists: (path: string) => boolean
  readonly root: string
}

/**
 * How to invoke the room CLI.
 *
 * `PATH` wins so the plugin and the shell agree; `ROOM_BIN` overrides both. The fallback must
 * name a real interpreter rather than `process.execPath`: the OpenCode server is a
 * bun-compiled binary, so there `process.execPath` is OpenCode, not Node.
 */
export const resolveLauncher = (env: LaunchEnvironment): Launcher => {
  if (env.override !== undefined && env.override !== "") return { command: env.override, args: [] }
  if (Option.isSome(env.onPath("room"))) return { command: "room", args: [] }
  const node = Option.getOrUndefined(env.onPath("node")) ?? env.execPath
  const built = join(env.root, "dist", "cli.js")
  if (env.exists(built)) return { command: node, args: [built] }
  const source = join(env.root, "src", "cli.ts")
  if (env.exists(source)) return { command: node, args: ["--conditions=development", source] }
  return { command: node, args: [join(env.root, "bin", "room.js")] }
}

const invoke = (): Launcher =>
  resolveLauncher({
    override: process.env.ROOM_BIN,
    onPath,
    execPath: process.execPath,
    exists: existsSync,
    root: packageRoot(),
  })

/** What a failed spawn carries: `execFile` rejects with the streams and a code. */
const Failure = Schema.Struct({
  code: Schema.optionalKey(Schema.Finite),
  stdout: Schema.optionalKey(Schema.String),
  stderr: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
})

/** One room invocation: the text and the exit code. A non-zero exit is a result, not a throw. */
interface Outcome {
  readonly output: string
  readonly code: number
}

const runRoom = async (
  cwd: string,
  args: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<Outcome> => {
  const { command, args: prefix } = invoke()
  const base = { cwd, maxBuffer: 8 * 1024 * 1024 }
  // SAFETY: execFile is a throwing API by construction, and a non-zero exit is this room's
  // normal result (a failed review, a missing roomd). The alternative -- Effect.tryPromise --
  // would wrap a transport that must stay usable from a host that does not run Effect.
  try {
    const { stdout, stderr } = await run(
      command,
      [...prefix, ...args],
      signal === undefined ? base : { ...base, signal },
    )
    return { output: (stdout.trim() === "" ? stderr : stdout).trim(), code: 0 }
  } catch (error) {
    const failed = Result.getOrUndefined(Schema.decodeUnknownResult(Failure)(error))
    const out = (failed?.stdout ?? "").trim()
    const err = (failed?.stderr ?? "").trim()
    const output = out === "" ? err : out
    return {
      output: output === "" ? (failed?.message ?? "room failed to run") : output,
      code: failed?.code ?? 1,
    }
  }
}

/** One tool's input, decoded at the boundary rather than asserted. */
const SessionIn = Schema.Struct({
  recent: Schema.optionalKey(Schema.Finite),
  room: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
})

const NoteIn = Schema.Struct({
  kind: Schema.String,
  data: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
})

const PlanIn = Schema.Struct({ cwd: Schema.optionalKey(Schema.String) })

const InitIn = Schema.Struct({
  room: Schema.String,
  project: Schema.String,
  projectName: Schema.String,
  label: Schema.optionalKey(Schema.String),
  linearUser: Schema.optionalKey(Schema.String),
  stage: Schema.optionalKey(Schema.String),
  force: Schema.optionalKey(Schema.Boolean),
  cwd: Schema.optionalKey(Schema.String),
})

const BoardIn = Schema.Struct({
  room: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
})

const directoryFor = (value: string | undefined, root: string): string =>
  value === undefined || value === "" ? root : resolve(root, value)

/** The five operations, shared by both plugin shapes. */
interface Ran {
  readonly content: string
  readonly metadata: { readonly exitCode: number; readonly cwd: string }
}

const sessionOp = async (
  input: Schema.Json | undefined,
  root: string,
  signal: AbortSignal | undefined,
): Promise<Ran> => {
  const options = Result.getOrUndefined(Schema.decodeUnknownResult(SessionIn)(input))
  const directory = directoryFor(options?.cwd, root)
  const recent = options?.recent === undefined ? "10" : String(options.recent)
  const named = options?.room === undefined ? [] : ["--room", options.room]
  const outcome = await runRoom(
    directory,
    ["session", "--cwd", directory, ...named, "--json", "--recent", recent],
    signal,
  )
  return { content: outcome.output, metadata: { exitCode: outcome.code, cwd: directory } }
}

const noteOp = async (
  input: Schema.Json | undefined,
  root: string,
  signal: AbortSignal | undefined,
): Promise<Ran> => {
  const options = Result.getOrUndefined(Schema.decodeUnknownResult(NoteIn)(input))
  const directory = directoryFor(options?.cwd, root)
  if (options === undefined) {
    return { content: "room note: kind is required", metadata: { exitCode: 2, cwd: directory } }
  }
  const args = ["session", "--cwd", directory, "--note", options.kind]
  if (options.data !== undefined) args.push("--data", options.data)
  const outcome = await runRoom(directory, args, signal)
  return { content: outcome.output, metadata: { exitCode: outcome.code, cwd: directory } }
}

const planOp = async (
  input: Schema.Json | undefined,
  root: string,
  signal: AbortSignal | undefined,
): Promise<Ran> => {
  const options = Result.getOrUndefined(Schema.decodeUnknownResult(PlanIn)(input))
  const directory = directoryFor(options?.cwd, root)
  const outcome = await runRoom(directory, ["plan", "--cwd", directory, "--json"], signal)
  return { content: outcome.output, metadata: { exitCode: outcome.code, cwd: directory } }
}

const initOp = async (
  input: Schema.Json | undefined,
  root: string,
  signal: AbortSignal | undefined,
): Promise<Ran> => {
  const options = Result.getOrUndefined(Schema.decodeUnknownResult(InitIn)(input))
  if (options === undefined) {
    return {
      content: "room init: room, project and projectName are required",
      metadata: { exitCode: 2, cwd: root },
    }
  }
  const directory = directoryFor(options.cwd, root)
  const args = [
    "init",
    "--cwd",
    directory,
    "--room",
    options.room,
    "--linear-project",
    options.project,
    "--linear-name",
    options.projectName,
  ]
  if (options.label !== undefined) args.push("--label", options.label)
  if (options.linearUser !== undefined) args.push("--linear-user", options.linearUser)
  if (options.stage !== undefined) args.push("--stage", options.stage)
  if (options.force === true) args.push("--force")
  const outcome = await runRoom(directory, args, signal)
  return { content: outcome.output, metadata: { exitCode: outcome.code, cwd: directory } }
}

const boardOp = async (
  input: Schema.Json | undefined,
  root: string,
  signal: AbortSignal | undefined,
): Promise<Ran> => {
  const options = Result.getOrUndefined(Schema.decodeUnknownResult(BoardIn)(input))
  const directory = directoryFor(options?.cwd, root)
  const named = options?.room === undefined ? [] : ["--room", options.room]
  const outcome = await runRoom(
    directory,
    ["board", "--cwd", directory, ...named, "--json"],
    signal,
  )
  return { content: outcome.output, metadata: { exitCode: outcome.code, cwd: directory } }
}

const DESCRIPTIONS = {
  session:
    "Read the room's durable conversation: its id, whether a run is working, why the last run stopped, and the most recent entries. Use it when the person asks what happened in the room.",
  note: "Record a fact in the room's durable conversation without asking the model anything (a write, not an input) -- decisions the surface cannot infer.",
  plan: "Read the room setup plan for this repository without writing anything. Show it to the person; room_init applies it only after they approve.",
  init: "Write room.config.json and register the room. Run only after a human approved the plan from room_plan: it creates a committed file and records the room in this machine's index. It does not create webhooks.",
  board:
    "Read the room's board: running, claimed, queued and failed review jobs, delivery waiting in the inbox, and which hosts are present.",
} as const

/** The V2 shape: a namespace and five tools, transformed into the host's tool catalog. */
const v2 = Plugin.define({
  id: "autotelic.room",

  async setup(ctx) {
    const root = ctx.location.directory

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "room",
        description:
          "The project room: a durable conversation per Linear project, the events that feed it, and the review jobs it runs.",
      })

      editor.add({
        name: "session",
        description: DESCRIPTIONS.session,
        input: {
          type: "object",
          properties: {
            recent: { type: "number", description: "How many entries to read. Default 10." },
            room: { type: "string", description: "A room name from the index." },
            cwd: { type: "string", description: "Repository to read. Default: this location." },
          },
          additionalProperties: false,
        },
        options: { namespace: "room", codemode: true },
        execute: async (input, context) =>
          sessionOp(Schema.is(Schema.Json)(input) ? input : undefined, root, context.signal),
      })

      editor.add({
        name: "note",
        description: DESCRIPTIONS.note,
        input: {
          type: "object",
          properties: {
            kind: { type: "string", description: "Entry kind, for example room.decision." },
            data: { type: "string", description: "JSON payload. Default {}." },
            cwd: { type: "string", description: "Repository to write to. Default: this location." },
          },
          required: ["kind"],
          additionalProperties: false,
        },
        options: { namespace: "room", codemode: true },
        execute: async (input, context) =>
          noteOp(Schema.is(Schema.Json)(input) ? input : undefined, root, context.signal),
      })

      editor.add({
        name: "plan",
        description: DESCRIPTIONS.plan,
        input: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Repository to inspect. Default: this location." },
          },
          additionalProperties: false,
        },
        options: { namespace: "room", codemode: true },
        execute: async (input, context) =>
          planOp(Schema.is(Schema.Json)(input) ? input : undefined, root, context.signal),
      })

      editor.add({
        name: "init",
        description: DESCRIPTIONS.init,
        input: {
          type: "object",
          properties: {
            room: { type: "string", description: "Room name, for example multi-season." },
            project: { type: "string", description: "Linear project id (linearis projects list)." },
            projectName: {
              type: "string",
              description: "Linear project name, as a person reads it.",
            },
            label: { type: "string", description: "The GitHub label that addresses this room." },
            linearUser: { type: "string", description: "The Linear display name for this person." },
            stage: { type: "string", description: "Where the room runs. Default local/<login>." },
            force: { type: "boolean", description: "Rewrite an existing room.config.json." },
            cwd: { type: "string", description: "Repository to write to. Default: this location." },
          },
          required: ["room", "project", "projectName"],
          additionalProperties: false,
        },
        options: { namespace: "room", codemode: true },
        execute: async (input, context) =>
          initOp(Schema.is(Schema.Json)(input) ? input : undefined, root, context.signal),
      })

      editor.add({
        name: "board",
        description: DESCRIPTIONS.board,
        input: {
          type: "object",
          properties: {
            room: { type: "string", description: "A room name from the index." },
            cwd: { type: "string", description: "Repository to read. Default: this location." },
          },
          additionalProperties: false,
        },
        options: { namespace: "room", codemode: true },
        execute: async (input, context) =>
          boardOp(Schema.is(Schema.Json)(input) ? input : undefined, root, context.signal),
      })
    })
  },
})

/**
 * The V1 shape: opencode 1.x wants `default.id` plus `default.server()`, whose result carries
 * the tools at their flat names. The handlers are the same operations, so the two hosts cannot
 * drift.
 */
const server = async () => {
  const root = process.cwd()
  return {
    tool: {
      room_session: {
        description: DESCRIPTIONS.session,
        args: {},
        execute: async (input: Schema.Json) => (await sessionOp(input, root, undefined)).content,
      },
      room_note: {
        description: DESCRIPTIONS.note,
        args: {},
        execute: async (input: Schema.Json) => (await noteOp(input, root, undefined)).content,
      },
      room_plan: {
        description: DESCRIPTIONS.plan,
        args: {},
        execute: async (input: Schema.Json) => (await planOp(input, root, undefined)).content,
      },
      room_init: {
        description: DESCRIPTIONS.init,
        args: {},
        execute: async (input: Schema.Json) => (await initOp(input, root, undefined)).content,
      },
      room_board: {
        description: DESCRIPTIONS.board,
        args: {},
        execute: async (input: Schema.Json) => (await boardOp(input, root, undefined)).content,
      },
    },
  }
}

export default { ...v2, id: "autotelic.room", server }
