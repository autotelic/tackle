/* oxlint-disable plumb-effect/guarded-op-must-return-effect -- binary lookup returns Option because absence is a normal host state, not a failure reason */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Option } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/*
 * Local session discovery is a read of another program's JSON, not a second model of it.
 * Herdr owns terminals; Rex owns its sessions. A host without the binary reports
 * unavailable, never an empty "nothing is running" claim.
 */

const HerdrTerminal = Schema.Struct({
  address: Schema.String,
  agent: Schema.optional(Schema.String),
  cwd: Schema.String,
  state: Schema.String,
  status: Schema.optional(Schema.String),
  turn: Schema.optional(Schema.Finite),
  where: Schema.optional(Schema.String),
})

const HerdrListing = Schema.Struct({ terminals: Schema.Array(HerdrTerminal) })
const RexSessions = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ session_id: Schema.String, label: Schema.String })),
})

const RexBlocks = Schema.Struct({
  blocks: Schema.Array(
    Schema.Struct({
      block_id: Schema.String,
      label: Schema.String,
      creator_name: Schema.optional(Schema.String),
      flavor: Schema.String,
      host_id: Schema.String,
      placement: Schema.String,
      window_id: Schema.String,
    }),
  ),
})

const HerdrLabels = Schema.Struct({
  labels: Schema.Record(Schema.String, Schema.String),
})

export interface Session {
  readonly source: "herdr" | "rex"
  readonly address: string
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly state: string
  readonly status: string
  readonly turn: number | undefined
  readonly where: string | undefined
  readonly labels?: Readonly<Record<string, string>>
  readonly roomId?: string
  /** How the session joined: its workstream evidence, or a room label when there is none. */
  readonly joinedBy?: "label" | "factory" | "cwd" | "title"
  readonly workstream?: string
}

/** A workstream join and the evidence that produced it; never a guess without a word. */
export interface WorkstreamJoin {
  readonly workstream: string
  readonly joinedBy: "label" | "factory" | "cwd" | "title"
}

export interface WorkstreamPointer {
  readonly id: string
  readonly label: string
  readonly repo: string
  readonly path: string
  readonly project: string
}

/**
 * Join a live session to the workstream it is doing work for, and say how.
 *
 * An explicit `workstream` label wins; a factory desk belongs to the factory
 * workstream; then the session's cwd and tab words are the only evidence left.
 * The evidence is part of the answer because a cwd join is provisional: the
 * terminal may have `cd`-ed into a worktree without working on it.
 */
export const joinFor = (
  session: Session,
  workstreams: ReadonlyArray<WorkstreamPointer>,
): Option.Option<WorkstreamJoin> => {
  const explicit = session.labels?.workstream
  if (explicit !== undefined && workstreams.some((workstream) => workstream.id === explicit))
    return Option.some({ workstream: explicit, joinedBy: "label" })
  if (session.labels?.factory === "desk") {
    const factory = workstreams.find((workstream) => workstream.project === "factory")
    return factory === undefined
      ? Option.none()
      : Option.some({ workstream: factory.id, joinedBy: "factory" })
  }
  if (session.cwd !== undefined) {
    const byPath = workstreams
      .filter(
        (workstream) =>
          session.cwd === workstream.path ||
          session.cwd?.startsWith(workstream.path + "/") === true,
      )
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (byPath !== undefined) return Option.some({ workstream: byPath.id, joinedBy: "cwd" })
  }
  const words = new Set(
    (session.where ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  )
  for (const workstream of workstreams) {
    const labelWords = workstream.label.toLowerCase().split("-")
    if (labelWords.some((word) => word.length >= 5 && words.has(word)))
      return Option.some({ workstream: workstream.id, joinedBy: "title" })
  }
  return Option.none()
}

/**
 * The served session keeps the fields the view renders, including cwd (the
 * session's own evidence) and the join result. Labels stay local: `joinedBy`
 * already names the join, so the raw label map need not leave the machine.
 */
export const sessionOnWire = (session: Session): Omit<Session, "labels"> => {
  const { labels: _labels, ...rest } = session
  return rest
}

/** The joined workstream id, for callers that do not need the evidence. */
export const workstreamFor = (
  session: Session,
  workstreams: ReadonlyArray<WorkstreamPointer>,
): Option.Option<string> => Option.map(joinFor(session, workstreams), (join) => join.workstream)

/** Attach the workstream id and its evidence without inventing one when no evidence matches. */
export const tagWorkstreams = (
  sessions: ReadonlyArray<Session>,
  workstreams: ReadonlyArray<WorkstreamPointer>,
): ReadonlyArray<Session> =>
  sessions.map((session) => {
    const join = Option.getOrUndefined(joinFor(session, workstreams))
    return join === undefined
      ? session
      : { ...session, workstream: join.workstream, joinedBy: join.joinedBy }
  })

export interface SessionSource {
  readonly available: boolean
  readonly sessions: ReadonlyArray<Session>
  readonly note?: string
}

export interface SessionDiscovery {
  readonly herdr: SessionSource
  readonly rex: SessionSource
}

type Run = (input: {
  readonly command: string
  readonly args: ReadonlyArray<string>
}) => Promise<string>

const run: Run = async ({ command, args }) => {
  const result = await promisify(execFile)(command, [...args], {
    timeout: 2_000,
    maxBuffer: 1_000_000,
  })
  return result.stdout
}

/** HERDR_BIN first, then PATH, then the installer's default location. */
export const findHerdrBinary = (): Option.Option<string> => herdrBin(existsSync)

const herdrBin = (exists: (path: string) => boolean): Option.Option<string> => {
  if (process.env.HERDR_BIN !== undefined && process.env.HERDR_BIN !== "")
    return Option.some(process.env.HERDR_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "hc")
    if (exists(candidate)) return Option.some(candidate)
  }
  const local = join(homedir(), ".local", "bin", "hc")
  return exists(local) ? Option.some(local) : Option.none()
}

/**
 * Normalize one hc ls --json document.
 *
 * @param text - the command's stdout.
 * @returns sessions in address order, or [] when the shape does not decode.
 */
export const parseHerdr = (text: string): ReadonlyArray<Session> => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(HerdrListing))(text)
  if (Result.isFailure(decoded)) return []
  return decoded.success.terminals.map((terminal) => ({
    source: "herdr" as const,
    address: terminal.address,
    agent: terminal.agent,
    cwd: terminal.cwd,
    state: terminal.state,
    status: terminal.status ?? "",
    turn: terminal.turn,
    where: terminal.where,
  }))
}

const parseLabels = (text: string): Option.Option<Readonly<Record<string, string>>> => {
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  if (Result.isFailure(json)) return Option.none()
  const decoded = Schema.decodeUnknownResult(HerdrLabels)(json.success)
  return Result.isSuccess(decoded) ? Option.some(decoded.success.labels) : Option.none()
}

/**
 * Ask each terminal for its labels; the label is the explicit room claim.
 *
 * @param input - parsed sessions, the hc command, and the runner.
 * @returns the sessions with labels and roomId when room=<id> is set.
 */
export const enrichHerdr = async (input: {
  readonly sessions: ReadonlyArray<Session>
  readonly command: string
  readonly run: Run
}): Promise<ReadonlyArray<Session>> =>
  Promise.all(
    input.sessions.map(async (session) => {
      const output = await input
        .run({ command: input.command, args: ["get", session.address, "--json"] })
        .catch(() => undefined)
      if (output === undefined) return session
      const parsed = parseLabels(output)
      if (Option.isNone(parsed)) return session
      const labels = parsed.value
      const roomId = labels.room
      return roomId === undefined
        ? { ...session, labels }
        : { ...session, labels, roomId, joinedBy: "label" as const }
    }),
  )

/** Read Herdr's live terminals; a missing binary or bad JSON is "unavailable", not silence. */
export const discoverHerdr = async (deps?: {
  readonly run?: Run
  readonly exists?: (path: string) => boolean
}): Promise<SessionSource> => {
  const binary = herdrBin(deps?.exists ?? existsSync)
  if (Option.isNone(binary)) return { available: false, sessions: [] }
  const output = await (deps?.run ?? run)({
    command: binary.value,
    args: ["ls", "--json"],
  }).catch(() => undefined)
  if (output === undefined) return { available: true, sessions: [] }
  return {
    available: true,
    sessions: await enrichHerdr({
      sessions: parseHerdr(output),
      command: binary.value,
      run: deps?.run ?? run,
    }),
  }
}

const REX_APP = "/Applications/Rex Beta.app"
const REX_SERVER = join(
  homedir(),
  "Library",
  "Application Support",
  "com.superlogical.rex",
  "RexServer",
  "Versions",
  "Current",
  "Rex Server.app",
  "Contents",
  "MacOS",
  "rex",
)

/** REX_BIN first, then PATH, then the server bundled with the app. */
export const findRexBinary = (): Option.Option<string> => rexBin(existsSync)

const rexBin = (exists: (path: string) => boolean): Option.Option<string> => {
  if (process.env.REX_BIN !== undefined && process.env.REX_BIN !== "")
    return Option.some(process.env.REX_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "rex")
    if (exists(candidate)) return Option.some(candidate)
  }
  return exists(REX_SERVER) ? Option.some(REX_SERVER) : Option.none()
}

const parseRexSessions = (text: string) => {
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  if (Result.isFailure(json)) return Option.none()
  const decoded = Schema.decodeUnknownResult(RexSessions)(json.success)
  return Result.isSuccess(decoded) ? Option.some(decoded.success.sessions) : Option.none()
}

const parseRexBlocks = (text: string) => {
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  if (Result.isFailure(json)) return Option.none()
  const decoded = Schema.decodeUnknownResult(RexBlocks)(json.success)
  return Result.isSuccess(decoded) ? Option.some(decoded.success.blocks) : Option.none()
}

/** Read Rex's sessions and each session's blocks; the server socket is the source. */
export const discoverRex = async (deps?: {
  readonly run?: Run
  readonly exists?: (path: string) => boolean
}): Promise<SessionSource> => {
  const binary = rexBin(deps?.exists ?? existsSync)
  if (Option.isNone(binary)) {
    const app = [REX_APP, "/Applications/Rex.app"].some((path) =>
      (deps?.exists ?? existsSync)(path),
    )
    return app
      ? {
          available: true,
          sessions: [],
          note: "Rex app is installed, but its server binary was not found.",
        }
      : { available: false, sessions: [] }
  }
  const command = binary.value
  const execute = deps?.run ?? run
  const listing = await execute({
    command,
    args: ["session", "list", "--json"],
  }).catch(() => undefined)
  if (listing === undefined) return { available: true, sessions: [] }
  const sessions = parseRexSessions(listing)
  if (Option.isNone(sessions)) return { available: true, sessions: [] }

  const blocks = await Promise.all(
    sessions.value.map(async (session) => {
      const output = await execute({
        command,
        args: ["block", "list", "-s", session.label, "--json"],
      }).catch(() => undefined)
      if (output === undefined) return []
      const parsed = parseRexBlocks(output)
      if (Option.isNone(parsed)) return []
      return parsed.value.map((block): Session => ({
        source: "rex" as const,
        address: block.block_id,
        agent: block.creator_name,
        cwd: undefined,
        state: block.placement,
        status: block.flavor,
        turn: undefined,
        where: session.label,
        labels: { session: session.label, block: block.label },
      }))
    }),
  )
  return { available: true, sessions: blocks.flat() }
}

/**
 * Both local sources, each saying whether it was actually available.
 *
 * @returns Herdr's terminals and Rex's availability.
 */
export const discoverSessions = async (): Promise<SessionDiscovery> => ({
  herdr: await discoverHerdr(),
  rex: await discoverRex(),
})
