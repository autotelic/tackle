import { Predicate } from "effect"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
