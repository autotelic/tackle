// The subpaths, not the package root: the root re-exports `AgentOs.ts`, which loads
// `@rivet-dev/agentos-core` at import time, and the kernel is not the process that boots a VM.
import { readRoom, roomDir, roomSoftware } from "@autotelic/room/store"
import { ensureVmSupervisor, readVmStatus, vmExec } from "@autotelic/room/VmSupervisor"
import { resolve } from "node:path"
import type { RoomBinding } from "./store.ts"

/*
 * A bound pass runs in its room's VM, not on the host beside it.
 *
 * The room owns the VM: one supervisor per room, one socket, one filesystem
 * (`packages/room/src/VmSupervisor.ts`). So the kernel does not boot a second one — it asks the
 * room's supervisor for the room's guest and hands it one command. The alternative, a pass whose
 * cwd was the room's checkout while the process ran on the host, is the thing this module exists
 * to make impossible: the cwd would have moved and the machine would not have.
 *
 * The kernel stays outside the room. What crosses is one command with an environment, and the
 * exit code comes back the same shape the host runner produces, so the receipt, the budget and
 * the blocked-on-human exit read the same for both.
 */

/** A room's VM, as a pass uses it: what is up, and one command in the guest. */
export interface RoomGuest {
  readonly start: (input: GuestStartInput) => Promise<GuestStart>
  readonly run: (input: GuestRunInput) => Promise<GuestRun>
}

export interface GuestStartInput {
  /** The binding, so a refusal names the room the record points at. */
  readonly room: RoomBinding
  /** The room's checkout, projected into the guest at `/workspace`. */
  readonly worktree: string
}

/**
 * What a boot found.
 *
 * `started` is the difference between "the pass booted this VM" and "the room already had one":
 * the room owns the VM's lifetime, so a pass that starts one records it instead of stopping it.
 */
export type GuestStart =
  | {
      readonly ok: true
      readonly socket: string
      readonly pid: number
      readonly started: boolean
    }
  | { readonly ok: false; readonly reason: string }

export interface GuestRunInput {
  readonly socket: string
  readonly room: RoomBinding
  /** The worker as the factory writes it: one shell command, not a program and its arguments. */
  readonly worker: string
  readonly env: Readonly<Record<string, string>>
  /** The pass's wall budget, which the guest command is not allowed to outlive. */
  readonly wallMs: number
}

/**
 * What one guest command did.
 *
 * The three failures are separate on purpose: `timeout` is this pass spending its budget,
 * `exec` is the supervisor answering nothing, and `gap` is the guest not having the program —
 * a fact about the room's declaration that no retry of the same pass will change.
 */
export type GuestRun =
  | {
      readonly ok: true
      readonly status: number
      readonly stdout: string
      readonly stderr: string
    }
  | { readonly ok: false; readonly kind: "gap" | "exec" | "timeout"; readonly reason: string }

/** The worker environment as the exec request carries it: strings, no undefined entries. */
export const guestEnv = (source: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )

/** The shell a worker command runs under in the guest; the factory's workers are shell commands. */
const guestShell = "sh"

/** The exit status a shell reports for a program it could not find, and one it could not run. */
const commandMissing = new Set([126, 127])

/**
 * The guest's own `command not found`, said in the room's words.
 *
 * The shell's message names the program and nothing else; an operator reading a receipt needs the
 * room, the declaration that was supposed to provide it, and the way out.
 */
const gapReason = async (input: GuestRunInput, said: string): Promise<string> => {
  const root = resolve(input.room.root)
  // SAFETY: a room file that does not decode is a detail in a refusal, not a crash in it.
  const record = await readRoom({ root, id: input.room.id }).catch(() => undefined)
  const declared = roomSoftware(record).packages
  // The shell writes one line per failure; the first is the one an operator reads.
  const first = said.trim().split("\n")[0] ?? said.trim()
  return (
    "RoomVmWorkerGap: room " +
    input.room.id +
    " could not run the worker in its guest (" +
    first +
    "); declare what it needs in room.json (declared software: " +
    (declared.length === 0 ? "none" : declared.join(", ")) +
    ") or run this workstream unbound"
  )
}

/** The room's own supervisor as the guest a pass uses. */
export const supervisorGuest: RoomGuest = {
  start: async (input) => {
    // A room file may be addressed relative to the caller's cwd; the supervisor is a detached
    // process with another cwd, so the paths it is handed are resolved here.
    const root = resolve(input.room.root)
    const paths = { root, id: input.room.id }
    // The look before the boot is what makes `started` a fact rather than a guess: an already
    // running supervisor is the room's, and this pass is a guest in it.
    const before = await readVmStatus(paths)
    const booted = await ensureVmSupervisor({
      root,
      id: input.room.id,
      worktree: input.worktree,
      // The room's own directory, the one `room vm start` uses: one VM per room means one state
      // directory, or the second boot is a second filesystem wearing the room's name.
      stateDir: roomDir(paths),
    })
    if (!booted.ok) return { ok: false, reason: "RoomVmUnavailable: " + booted.reason }
    return {
      ok: true,
      socket: booted.run.socket,
      pid: booted.run.pid,
      started: before.state !== "running",
    }
  },
  run: async (input) => {
    // The connect is bounded inside the client; the command is not. The pass's own wall budget
    // is therefore the only thing that ends a guest command, and it cannot kill it: the
    // supervisor answers one request at a time, so a stop request would queue behind the worker
    // it means to stop. A timed-out guest command may still be running, which the reason says.
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<"timeout">((settle) => {
      timer = setTimeout(() => settle("timeout"), input.wallMs)
    })
    const answered = await Promise.race([
      vmExec({
        socket: input.socket,
        request: {
          kind: "exec",
          command: guestShell,
          args: ["-c", input.worker],
          env: { ...input.env },
        },
      }).catch((cause: unknown) => ({ kind: "error" as const, message: String(cause) })),
      expired,
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
    if (answered === "timeout")
      return {
        ok: false,
        kind: "timeout",
        reason:
          "RoomVmTimeout: the guest did not finish the worker within wallMinutesPerPass (" +
          Math.round(input.wallMs / 60_000) +
          "m); it may still be running in room " +
          input.room.id,
      }
    if (answered.kind === "error")
      return { ok: false, kind: "exec", reason: "RoomVmExec: " + answered.message }
    if (answered.kind !== "result")
      return {
        ok: false,
        kind: "exec",
        reason: "RoomVmExec: unexpected supervisor answer: " + answered.kind,
      }
    if (commandMissing.has(answered.exitCode))
      return {
        ok: false,
        kind: "gap",
        reason: await gapReason(input, answered.stderr || answered.stdout),
      }
    return {
      ok: true,
      status: answered.exitCode,
      stdout: answered.stdout,
      stderr: answered.stderr,
    }
  },
}
