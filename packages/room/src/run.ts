import { Predicate } from "effect"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/** The supervisor a room owns while it is up; separate from the control-plane state. */
export const RoomRun = Schema.Struct({
  pid: Schema.Finite,
  child: Schema.optional(Schema.Finite),
  exec: Schema.String,
  startedAt: Schema.Finite,
  log: Schema.String,
})

export type RoomRun = typeof RoomRun.Type

/**
 * The run record for a room.
 *
 * @param input - the room root and id.
 * @returns the absolute-ish path to `run.json`.
 */
export const runFile = (input: { readonly root: string; readonly id: string }): string =>
  join(input.root, input.id, "run.json")

/**
 * Read a room's run record; malformed content is absence, not a crash.
 *
 * @param input - the room root and id.
 * @returns the record, or undefined when absent or malformed.
 */
export const readRun = async (input: {
  readonly root: string
  readonly id: string
}): Promise<RoomRun | undefined> => {
  const text = await readFile(runFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(RoomRun))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/**
 * Write a room's run record.
 *
 * @param input - the room root, id, and record.
 * @returns a promise that resolves when the record is written.
 */
export const writeRun = async (input: {
  readonly root: string
  readonly id: string
  readonly run: RoomRun
}): Promise<void> => {
  await writeFile(runFile(input), JSON.stringify(input.run, null, 2) + "\n")
}

/**
 * Remove a room's run record.
 *
 * @param input - the room root and id.
 * @returns a promise that resolves when the file is gone.
 */
export const removeRun = async (input: {
  readonly root: string
  readonly id: string
}): Promise<void> => {
  await rm(runFile(input), { force: true })
}

/** Whether a pid still answers signals; ESRCH is the expected false. */
export const alive: Predicate.Predicate<number> = (pid) => {
  // SAFETY: signalling a PID is a process boundary; ESRCH is the expected absence.
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export type StartOutcome =
  | { readonly ok: true; readonly run: RoomRun }
  | { readonly ok: false; readonly reason: string }

/** The supervisor script, source in development and build after a build. */
const supervisorPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  return existsSync(join(here, "supervise.js"))
    ? join(here, "supervise.js")
    : join(here, "supervise.ts")
}

/**
 * Start the detached supervisor for one room and wait until its run record is live.
 *
 * @param input - the room root and id, the worktree, the command, its log path, and the port
 * the room leases for it.
 * @returns the live run record, or the reason no supervisor claimed the room.
 */
export const startRoomRun = async (input: {
  readonly root: string
  readonly id: string
  readonly worktree: string
  readonly exec: string
  readonly log: string
  readonly port?: number | undefined
}): Promise<StartOutcome> => {
  await removeRun(input)
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      supervisorPath(),
      "--root",
      input.root,
      "--id",
      input.id,
      "--cwd",
      input.worktree,
      "--exec",
      input.exec,
      "--log",
      input.log,
      // The lease is the one owner of the number: the command is told which port it has so the
      // probe and the process cannot answer on different ones.
      ...(input.port === undefined ? [] : ["--port", String(input.port)]),
    ],
    { detached: true, stdio: "ignore" },
  )
  child.unref()
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = await readRun(input)
    if (run !== undefined && alive(run.pid)) return { ok: true, run }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return { ok: false, reason: "supervisor did not start; see " + runFile(input) }
}

export type SignalOutcome = "signalled" | "no-process"

/**
 * Signal the room's process group, not just its supervisor: the supervisor is the group
 * leader, so the child it started is stopped and continued with it.
 */
export const signalRun = async (input: {
  readonly root: string
  readonly id: string
  readonly signal: "SIGSTOP" | "SIGCONT" | "SIGTERM"
}): Promise<SignalOutcome> => {
  const run = await readRun(input)
  if (run === undefined || !alive(run.pid)) {
    await removeRun(input)
    return "no-process"
  }
  process.kill(-run.pid, input.signal)
  return "signalled"
}
