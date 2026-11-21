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
  status: Schema.String,
  turn: Schema.optional(Schema.Finite),
  where: Schema.optional(Schema.String),
})

const HerdrListing = Schema.Struct({ terminals: Schema.Array(HerdrTerminal) })

export interface Session {
  readonly source: "herdr" | "rex"
  readonly address: string
  readonly agent: string | undefined
  readonly cwd: string
  readonly state: string
  readonly status: string
  readonly turn: number | undefined
  readonly where: string | undefined
  readonly roomId?: string
  readonly joinedBy?: "cwd" | "session"
}

export interface SessionSource {
  readonly available: boolean
  readonly sessions: ReadonlyArray<Session>
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
    status: terminal.status,
    turn: terminal.turn,
    where: terminal.where,
  }))
}

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
  return { available: true, sessions: parseHerdr(output) }
}

/** Rex has no stable machine-readable session command yet; report the binary only. */
export const discoverRex = async (deps?: {
  readonly exists?: (path: string) => boolean
}): Promise<SessionSource> => {
  const exists = deps?.exists ?? existsSync
  const onPath = (process.env.PATH ?? "")
    .split(":")
    .filter((dir) => dir !== "")
    .some((dir) => exists(join(dir, "rex")))
  return { available: onPath, sessions: [] }
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
