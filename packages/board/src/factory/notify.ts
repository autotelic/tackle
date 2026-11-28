import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { listDesk } from "./desk.ts"
import {
  defaultNotifyOutcomes,
  readWorkstream,
  type NotifyOutcome,
  type Workstream,
} from "./store.ts"
import { newestDesk } from "./truth.ts"

/*
 * The return edge: a pass that ended tells the session that started it.
 *
 * `factory status` is the truth, and it is pull: the chief learned that a pass finished, a gate
 * parked the workstream, or the worker died, by asking every ten minutes. This module is the
 * one push. It sends exactly one message per finished pass, through the intercom CLI the host
 * already has, and it changes nothing about the pass: a missing binary or an unreachable
 * session is recorded on the receipt, never turned into a pass failure.
 *
 * There is no notification store. The receipt is the record of what was told and whether it
 * arrived, so `factory status` keeps reading one receipt per pass and no second log can drift
 * from it.
 */

/** What one pass's receipt keeps about its notification attempt. */
export interface Notice {
  readonly session: string
  readonly outcome: NotifyOutcome
  /** Whether the CLI accepted it; a refusal is a fact about delivery, not about the pass. */
  readonly sent: boolean
  readonly detail?: string | undefined
  readonly at: string
}

/**
 * The part of a finished pass a notice is built from.
 *
 * Structural rather than the kernel's `PassOutcome`, so this module need not import the kernel
 * that imports it.
 */
export interface FinishedPass {
  readonly ok: boolean
  readonly reason?: string | undefined
  readonly receipt?:
    | {
        readonly workstream: string
        readonly pass: number
        readonly phase: Workstream["phase"]
        readonly checkpoint?: string | undefined
        readonly commit?: string | undefined
      }
    | undefined
}

/**
 * Which of the four things this pass is, or undefined when nothing reached a reader.
 *
 * A refusal before the receipt exists — a lock held by another pass, a workstream already
 * retired — is not an outcome: nobody worked, so nobody is told. The room's own refusals are
 * gates: its declaration is what was missing, and no retry of the same pass changes that.
 */
export const outcomeOf = (pass: FinishedPass): NotifyOutcome | undefined => {
  if (pass.receipt === undefined) return undefined
  if (pass.ok) return "done"
  const reason = pass.reason ?? ""
  if (reason === "blocked-on-human") return "blocked"
  if (
    reason.startsWith("gate-protected") ||
    reason === "quality-regressed" ||
    reason.startsWith("RoomVmWorkerGap") ||
    reason.startsWith("RoomVmUnavailable")
  )
    return "gate"
  return "failed"
}

/**
 * The message: the fields the chief would have read out of `factory status`, in one line, and
 * the command that answers the rest.
 */
export const noticeText = (input: {
  readonly workstream: string
  readonly pass: number
  readonly outcome: NotifyOutcome
  readonly phase: string
  readonly checkpoint: string | null
  readonly commit: string | null
  readonly desk: string | null
  readonly reason: string | null
}): string =>
  [
    "factory " + input.workstream + " pass #" + input.pass + " " + input.outcome,
    "phase " + input.phase,
    "checkpoint " + (input.checkpoint === null ? "none" : input.checkpoint.slice(0, 8)),
    "commit " + (input.commit === null ? "none" : input.commit.slice(0, 8)),
    "desk " + (input.desk ?? "none"),
    ...(input.reason === null ? [] : ["reason " + input.reason]),
    "next: factory status --json",
  ].join(" \u00b7 ")

/** The intercom CLI installed beside Pi; the same override a worker asks through. */
const intercomCli = (): string =>
  process.env.PI_INTERCOM_CLI ??
  join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-intercom", "cli.mjs")

/** Long enough for a local intercom, short enough that a hung one cannot hold a pass. */
const SEND_TIMEOUT_MS = 15_000

/**
 * Send one message with wake, and never throw.
 *
 * Synchronous and bounded on purpose: the receipt has to say whether the chief was told, and a
 * detached send would leave that field guessing. A failed send is delivery detail.
 */
const send = (input: {
  readonly session: string
  readonly text: string
}): { readonly sent: boolean; readonly detail?: string } => {
  // SAFETY: a missing or unreachable CLI is delivery detail, not a pass failure.
  try {
    const result = spawnSync(
      process.execPath,
      [intercomCli(), "send", "--to", input.session, "--text", input.text],
      { encoding: "utf8", timeout: SEND_TIMEOUT_MS },
    )
    if (result.error !== undefined) return { sent: false, detail: String(result.error) }
    if (result.status !== 0)
      return {
        sent: false,
        detail: (result.stderr || "intercom exited " + String(result.status)).trim().slice(0, 300),
      }
    return { sent: true }
  } catch (cause) {
    return { sent: false, detail: String(cause) }
  }
}

/**
 * Tell the workstream's session how its pass ended.
 *
 * The desk id is the newest open item for this workstream, from the desk store: a gate that
 * waits for an answer is the thing the chief acts on, so it travels with the notice rather than
 * being fetched by a reader who was woken to fetch it.
 *
 * @param input - the finished pass, the instant the notice is attempted, and the factory home.
 * @returns the notice for the receipt, or undefined when there is no target or no ask for it.
 */
export const notifyPass = async (input: {
  readonly outcome: FinishedPass
  readonly at: string
  readonly home?: string | undefined
}): Promise<Notice | undefined> => {
  const receipt = input.outcome.receipt
  const outcome = outcomeOf(input.outcome)
  if (receipt === undefined || outcome === undefined) return undefined
  const record = await readWorkstream({ id: receipt.workstream, home: input.home })
  const notify = record?.notify
  if (notify === undefined) return undefined
  if (!(notify.outcomes ?? defaultNotifyOutcomes).includes(outcome)) return undefined
  const desk = newestDesk(
    (await listDesk({ home: input.home })).filter((item) => item.workstream === receipt.workstream),
  )
  const answer = send({
    session: notify.session,
    text: noticeText({
      workstream: receipt.workstream,
      pass: receipt.pass,
      outcome,
      phase: receipt.phase,
      checkpoint: receipt.checkpoint ?? null,
      commit: receipt.commit ?? null,
      desk: desk === null ? null : desk.id,
      reason: input.outcome.reason ?? null,
    }),
  })
  return {
    session: notify.session,
    outcome,
    sent: answer.sent,
    ...(answer.detail === undefined ? {} : { detail: answer.detail }),
    at: input.at,
  }
}
