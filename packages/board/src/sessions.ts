/* oxlint-disable plumb-effect/guarded-op-must-return-effect -- binary lookup returns Option because absence is a normal host state, not a failure reason */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Option, Predicate } from "effect"
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
  readonly joinedBy?: "label"
  readonly workstream?: string
}

export interface WorkstreamPointer {
  readonly id: string
  readonly label: string
  readonly repo: string
  readonly path: string
  readonly project: string
}

/**
 * Join a live session to the workstream it is doing work for.
 *
 * The only evidence is an explicit `workstream=<id>` label. A cwd, a tab name
 * and a project word are shared by every session in the repo; using them
 * focuses the wrong agent, which is worse than offering no Focus at all.
 */
export const workstreamFor = (
  session: Session,
  workstreams: ReadonlyArray<WorkstreamPointer>,
): Option.Option<string> => {
  const explicit = session.labels?.workstream
  return explicit !== undefined && workstreams.some((workstream) => workstream.id === explicit)
    ? Option.some(explicit)
    : Option.none()
}

/** Attach the workstream id without inventing one when no evidence matches. */
export const tagWorkstreams = (
  sessions: ReadonlyArray<Session>,
  workstreams: ReadonlyArray<WorkstreamPointer>,
): ReadonlyArray<Session> =>
  sessions.map((session) => {
    const workstream = Option.getOrUndefined(workstreamFor(session, workstreams))
    return workstream === undefined ? session : { ...session, workstream }
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

/** The Herdr app's control CLI, or none when the app is not installed. */
export const findHerdrAppBinary = (): Option.Option<string> => {
  if (process.env.HERDR_APP_BIN !== undefined && process.env.HERDR_APP_BIN !== "")
    return Option.some(process.env.HERDR_APP_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "herdr-app")
    if (existsSync(candidate)) return Option.some(candidate)
  }
  const local = join(homedir(), ".local", "bin", "herdr-app")
  if (existsSync(local)) return Option.some(local)
  const app = "/Applications/Herdr.app/Contents/MacOS/Herdr"
  return existsSync(app) ? Option.some(app) : Option.none()
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

/**
 * Whether a source currently serves this address.
 *
 * The view's Open action posts an address, so the address is checked against discovery
 * rather than trusted: a target that vanished between the snapshot and the click is refused
 * instead of being handed to `hc attach` (the argv hazard in VISION.md), and a source is not
 * exchangeable for the other one. Discovery is the same read `/presence` serves, so the two
 * cannot drift.
 */
export const servesAddress: Predicate.Predicate<{
  readonly discovery: SessionDiscovery
  readonly source: Session["source"]
  readonly address: string
}> = (input) =>
  (input.source === "herdr" ? input.discovery.herdr : input.discovery.rex).sessions.some(
    (session) => session.address === input.address,
  )
