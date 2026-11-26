import { Schema } from "effect"
import * as Result from "effect/Result"
import { spawn } from "node:child_process"
import { closeSync, existsSync, openSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { alive } from "./run.ts"
import { roomDir } from "./store.ts"

/*
 * One room's VM supervisor: a detached process that owns the room's agentOS instance and
 * answers exec requests on a Unix socket. Booting a VM costs more than most room commands, so
 * the supervisor is what lets a second command see the first one's VM instead of paying a boot
 * per invocation. The control plane here never touches the VM itself; it spawns, reads and
 * stops the process, and hands one request over a socket.
 */

/** The socket the room's VM supervisor answers on, inside the room's own directory. */
export const vmSocketFile = (input: { readonly root: string; readonly id: string }): string =>
  join(roomDir(input), "vm.sock")

/** The record of the live supervisor, beside the room file it belongs to. */
export const vmRunFile = (input: { readonly root: string; readonly id: string }): string =>
  join(roomDir(input), "vm.json")

/** Everything the supervisor printed, including the VM sidecar's own diagnostics. */
export const vmLogFile = (input: { readonly root: string; readonly id: string }): string =>
  join(roomDir(input), "vm.log")

/**
 * The supervisor a room's VM runs in.
 *
 * It is written once the socket is bound, so a record with a dead pid is a supervisor that
 * never came up or has already gone: stale, never live.
 */
export const VmRun = Schema.Struct({
  pid: Schema.Finite,
  socket: Schema.String,
  worktree: Schema.String,
  stateDir: Schema.String,
  database: Schema.String,
  log: Schema.optional(Schema.String),
  startedAt: Schema.Finite,
})
export type VmRun = typeof VmRun.Type

/** Read a room's supervisor record; malformed content is absence, not a crash. */
export const readVmRun = async (input: {
  readonly root: string
  readonly id: string
}): Promise<VmRun | undefined> => {
  const text = await readFile(vmRunFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(VmRun))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/** Write the record the next probe reads; the caller orders this after the socket is bound. */
export const writeVmRun = async (input: {
  readonly root: string
  readonly id: string
  readonly run: VmRun
}): Promise<void> => {
  await mkdir(roomDir({ root: input.root, id: input.id }), { recursive: true })
  await writeFile(vmRunFile(input), JSON.stringify(input.run, null, 2) + "\n")
}

/** Remove the record; absence is the expected second call. */
export const removeVmRun = async (input: {
  readonly root: string
  readonly id: string
}): Promise<void> => {
  await rm(vmRunFile(input), { force: true })
}

export type VmState = "running" | "stale" | "absent"

/** What a look at the room's supervisor found, and whether its socket is on disk. */
export interface VmStatus {
  readonly state: VmState
  readonly run: VmRun | undefined
  readonly socket: boolean
}

/**
 * Look at the room's VM supervisor.
 *
 * A record whose pid no longer answers is `stale`: the socket file may survive it, but nothing
 * is behind it, and a start may take both. Nothing is cached, so two looks in a row tell the
 * truth about a process that died between them.
 */
export const readVmStatus = async (input: {
  readonly root: string
  readonly id: string
}): Promise<VmStatus> => {
  const run = await readVmRun(input)
  const socket = existsSync(vmSocketFile(input))
  if (run === undefined) return { state: "absent", run: undefined, socket }
  return { state: alive(run.pid) ? "running" : "stale", run, socket }
}

/** One exec request, as it travels over the socket. */
export const VmExecRequest = Schema.Struct({
  kind: Schema.Literal("exec"),
  command: Schema.String,
  args: Schema.Array(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type VmExecRequest = typeof VmExecRequest.Type

/** What the command did, in the shape the CLI prints and exits on. */
export const VmExecResponse = Schema.Struct({
  kind: Schema.Literal("result"),
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Int,
  outcome: Schema.String,
  error: Schema.NullOr(Schema.String),
})

/** One HTTP request to a service listening inside the VM. */
export const VmHttpRequest = Schema.Struct({
  kind: Schema.Literal("http"),
  port: Schema.Int,
  path: Schema.String,
  method: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optional(Schema.String),
})
export type VmHttpRequest = typeof VmHttpRequest.Type

/** The service answer, body encoded as base64 so arbitrary bytes survive the socket. */
export const VmHttpResponse = Schema.Struct({
  kind: Schema.Literal("http"),
  status: Schema.Int,
  statusText: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})
export type VmHttpResponse = typeof VmHttpResponse.Type

/** Start a long-lived process in the VM; the supervisor keeps it until the room stops. */
export const VmServiceRequest = Schema.Struct({
  kind: Schema.Literal("service"),
  command: Schema.String,
  args: Schema.Array(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type VmServiceRequest = typeof VmServiceRequest.Type

export const VmServiceResponse = Schema.Struct({
  kind: Schema.Literal("service"),
  pid: Schema.Int,
})
export type VmServiceResponse = typeof VmServiceResponse.Type

/** A request the supervisor could not run at all; it carries no stdout or exit code. */
export const VmFailureResponse = Schema.Struct({
  kind: Schema.Literal("error"),
  message: Schema.String,
})

export const VmRequest = Schema.Union([VmExecRequest, VmHttpRequest, VmServiceRequest])
export type VmRequest = typeof VmRequest.Type

export const VmResponse = Schema.Union([
  VmExecResponse,
  VmHttpResponse,
  VmServiceResponse,
  VmFailureResponse,
])
export type VmResponse = typeof VmResponse.Type
export type VmExecResponse = typeof VmExecResponse.Type

/**
 * Send one request to a room's supervisor and read its one answer.
 *
 * The connect is bounded, the command is not: a command that runs for minutes is the reason
 * this socket exists, so a response timeout would cut off exactly the work it was started for.
 * A socket that is missing, refused or silent is a rejection, never an empty success.
 */
const sendVm = (input: {
  readonly socket: string
  readonly request: VmExecRequest | VmHttpRequest | VmServiceRequest
  readonly connectTimeoutMs?: number | undefined
}): Promise<VmResponse> =>
  new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const connection = connect({ path: input.socket })
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      connection.destroy()
      finish()
    }
    let answer = ""
    timer = setTimeout(
      () =>
        settle(() =>
          reject(new Error("vm supervisor did not accept a connection: " + input.socket)),
        ),
      input.connectTimeoutMs ?? 5_000,
    )
    connection.setEncoding("utf8")
    connection.once("connect", () => {
      if (timer !== undefined) clearTimeout(timer)
      connection.write(JSON.stringify(input.request) + "\n")
    })
    connection.on("data", (chunk: string) => {
      answer += chunk
    })
    // SAFETY: a refused or reset connection is the case this client exists to report.
    connection.on("error", (cause: Error) => settle(() => reject(cause)))
    connection.on("end", () =>
      settle(() => {
        const decoded = Schema.decodeResult(Schema.fromJsonString(VmResponse))(answer.trim())
        if (Result.isFailure(decoded))
          reject(
            new Error(
              "vm supervisor answered neither a result nor an error: " + answer.slice(0, 200),
            ),
          )
        else resolve(decoded.success)
      }),
    )
  })

export const vmExec = (input: {
  readonly socket: string
  readonly request: VmExecRequest
  readonly connectTimeoutMs?: number | undefined
}): Promise<VmResponse> => sendVm(input)

/** Ask a service inside the room's VM for one HTTP response. */
export const vmHttp = (input: {
  readonly socket: string
  readonly request: VmHttpRequest
  readonly connectTimeoutMs?: number | undefined
}): Promise<VmResponse> => sendVm(input)

/** Start a long-lived command inside the room's VM and return its guest pid. */
export const vmService = (input: {
  readonly socket: string
  readonly request: VmServiceRequest
  readonly connectTimeoutMs?: number | undefined
}): Promise<VmResponse> => sendVm(input)

/** The supervisor script, source in development and build after a build. */
const supervisorPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  return existsSync(join(here, "vm-supervise.js"))
    ? join(here, "vm-supervise.js")
    : join(here, "vm-supervise.ts")
}

export type VmStartOutcome =
  | { readonly ok: true; readonly run: VmRun }
  | { readonly ok: false; readonly reason: string }

export interface VmStartInput {
  readonly root: string
  readonly id: string
  /** The room's checkout, projected into the guest at `/workspace`. */
  readonly worktree: string
  /** The room's own directory: `agentos.sqlite` lives here, so the VM outlives the process. */
  readonly stateDir: string
  /** How long to wait for a booted VM to answer; a cold agentOS sidecar is not instant. */
  readonly waitMs?: number | undefined
}

/**
 * Start the detached supervisor for one room's VM.
 *
 * An already-running supervisor is the answer, not a second process: the room has one VM, and
 * two of them would be two filesystems pretending to be one room. A record left by a dead
 * supervisor is removed first, so the socket path is free for the process about to bind it.
 *
 * @param input - the room root and id, its worktree and state directory, and the boot budget.
 * @returns the live record, or the reason no supervisor claimed the room.
 */
export const startVmSupervisor = async (input: VmStartInput): Promise<VmStartOutcome> => {
  // The room file may be addressed relative to the caller's cwd; the supervisor is a detached
  // process with a different cwd, so every path it receives must already be absolute.
  const root = resolve(input.root)
  const worktree = resolve(input.worktree)
  const stateDir = resolve(input.stateDir)
  const paths = { root, id: input.id }
  const status = await readVmStatus(paths)
  if (status.state === "running" && status.run !== undefined) return { ok: true, run: status.run }
  // A stale record names a process that no longer answers, so it owns neither the socket nor
  // the VM; taking both is the recovery, and forgetting the record is what makes it honest.
  await removeVmRun(paths)
  await mkdir(roomDir(paths), { recursive: true })
  const log = vmLogFile(paths)
  const fd = openSync(log, "a")
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      supervisorPath(),
      "--root",
      root,
      "--id",
      input.id,
      "--worktree",
      worktree,
      "--state-dir",
      stateDir,
      "--socket",
      vmSocketFile(paths),
      "--log",
      log,
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  )
  closeSync(fd)
  child.unref()
  const waitMs = input.waitMs ?? 30_000
  for (let waited = 0; waited <= waitMs; waited += 100) {
    const next = await readVmStatus(paths)
    if (next.state === "running" && next.socket && next.run !== undefined)
      return { ok: true, run: next.run }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return { ok: false, reason: "vm supervisor did not come up; see " + log }
}

/** Use the room's supervisor if it is live, and start one only when it is not. */
export const ensureVmSupervisor = async (input: VmStartInput): Promise<VmStartOutcome> => {
  const status = await readVmStatus({ root: input.root, id: input.id })
  if (status.state === "running" && status.run !== undefined) return { ok: true, run: status.run }
  return startVmSupervisor(input)
}

/** What one stop did: it signalled a live supervisor, or cleared debris one left behind. */
export interface VmStopOutcome {
  readonly stopped: boolean
  readonly pid: number | undefined
  readonly detail: "stopped" | "stale" | "absent"
}

/** One signal, with the two failures that mean "already gone" reported instead of thrown. */
const signal = (target: number): boolean => {
  // SAFETY: signalling a pid is a process boundary; ESRCH is the expected absence.
  try {
    process.kill(target, "SIGTERM")
    return true
  } catch {
    return false
  }
}

/**
 * Ask the supervisor's own process group to go away.
 *
 * The supervisor leads the group it was spawned into, so the agentOS sidecar it started is
 * signalled with it. A group already gone falls back to the pid, which is the one case where
 * the leader outlived its group.
 */
const signalSupervisor = (pid: number): void => {
  if (signal(-pid)) return
  signal(pid)
}

/**
 * Stop the room's VM supervisor and release its socket.
 *
 * A dead pid is stale, not a live pass: there is nothing to signal, so the record and the
 * socket file are simply cleared. A live supervisor is signalled with its whole group (the
 * agentOS sidecar is its child) and waited for, and only then are the socket and the record
 * removed — a next start must never find a path something still holds.
 *
 * @param input - the room root and id.
 * @returns whether a live supervisor was stopped, its pid, and which of the three cases it was.
 */
export const stopVmSupervisor = async (input: {
  readonly root: string
  readonly id: string
}): Promise<VmStopOutcome> => {
  const paths = { root: input.root, id: input.id }
  const socket = vmSocketFile(paths)
  const status = await readVmStatus(paths)
  if (status.run === undefined) {
    await rm(socket, { force: true })
    return { stopped: false, pid: undefined, detail: "absent" }
  }
  const pid = status.run.pid
  if (status.state === "stale") {
    await removeVmRun(paths)
    await rm(socket, { force: true })
    return { stopped: false, pid, detail: "stale" }
  }
  signalSupervisor(pid)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!alive(pid)) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await rm(socket, { force: true })
  await removeVmRun(paths)
  return { stopped: true, pid, detail: "stopped" }
}
