import { spawnSync } from "node:child_process"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { captureCheckpoint } from "./adopt.ts"
import { consumeEvents, readEvents, type Event } from "./events.ts"
import { readWorkstream, workstreamDir, writeWorkstream, type Workstream } from "./store.ts"

/** One pass's receipt; written before the worker starts because the pass is charged then. */
export interface Receipt {
  readonly workstream: string
  readonly pass: number
  readonly at: string
  readonly status: "running" | "done" | "failed"
  readonly phase: Workstream["phase"]
  readonly events: ReadonlyArray<string>
  readonly checkpoint: string | undefined
  readonly exit: number | undefined
}

/**
 * The receipts directory for one workstream.
 *
 * @param input - the workstream id and optional home.
 * @returns the directory path.
 */
export const receiptsDir = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(workstreamDir(input.home), input.id + ".receipts")

const receiptFile = (input: {
  readonly id: string
  readonly pass: number
  readonly home?: string | undefined
}): string => join(receiptsDir(input), String(input.pass).padStart(4, "0") + ".json")

const passesUsed = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<number> =>
  (await readdir(receiptsDir(input)).catch(() => [])).filter((name) => name.endsWith(".json"))
    .length

const writeReceipt = async (input: {
  readonly id: string
  readonly receipt: Receipt
  readonly home?: string | undefined
}): Promise<void> => {
  await mkdir(receiptsDir(input), { recursive: true })
  await writeFile(
    receiptFile({ id: input.id, pass: input.receipt.pass, home: input.home }),
    JSON.stringify(input.receipt, null, 2) + "\n",
  )
}

export type PassOutcome =
  | { readonly ok: true; readonly receipt: Receipt; readonly checkpoint: string }
  | { readonly ok: false; readonly reason: string; readonly receipt?: Receipt }

const promptOf = (input: {
  readonly record: Workstream
  readonly events: ReadonlyArray<Event>
}): string =>
  [
    "Workstream " +
      input.record.id +
      " (" +
      input.record.project +
      " / " +
      input.record.label +
      ").",
    "Phase: " + input.record.phase + ". Worktree: " + input.record.path + ".",
    "PR " + input.record.pr + " on " + input.record.repo + ".",
    "Handle only these events, then stop and write a receipt:",
    ...input.events.map(
      (event) => "- " + event.kind + " " + event.id + " " + JSON.stringify(event.payload),
    ),
    "Do not merge. Do not edit the SOW. Do not touch another workstream.",
  ].join("\n")

/**
 * Run one pass over the pending events. The pass is charged when it starts, not when it ends.
 *
 * @param input - the workstream, the worker command, and the timestamp.
 * @returns the receipt and checkpoint, or the refusal.
 */
export const runPass = async (input: {
  readonly id: string
  readonly worker: string
  readonly at: string
  readonly home?: string | undefined
}): Promise<PassOutcome> => {
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { ok: false, reason: "WorkstreamNotFound" }
  if (record.phase === "done") return { ok: false, reason: "WorkstreamDone" }
  if (record.phase === "blocked") return { ok: false, reason: "WorkstreamBlocked" }

  const used = await passesUsed({ id: input.id, home: input.home })
  if (used >= record.budgets.passesPerPhase)
    return { ok: false, reason: "budget: passesPerPhase " + record.budgets.passesPerPhase }

  const events = (await readEvents({ id: input.id, home: input.home })).filter(
    (event) => event.status === "pending",
  )
  if (events.length === 0) return { ok: false, reason: "NoPendingEvents" }

  const pass = used + 1
  const receipt: Receipt = {
    workstream: record.id,
    pass,
    at: input.at,
    status: "running",
    phase: record.phase,
    events: events.map((event) => event.id),
    checkpoint: undefined,
    exit: undefined,
  }
  await writeReceipt({ id: input.id, receipt, home: input.home })

  const result = spawnSync(input.worker, {
    cwd: record.path,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      FACTORY_WORKSTREAM: record.id,
      FACTORY_PROJECT: record.project,
      FACTORY_PHASE: record.phase,
      FACTORY_EVENTS: JSON.stringify(events),
      FACTORY_PROMPT: promptOf({ record, events }),
    },
  })

  if (result.status !== 0) {
    const failed: Receipt = { ...receipt, status: "failed", exit: result.status ?? -1 }
    await writeReceipt({ id: input.id, receipt: failed, home: input.home })
    return { ok: false, reason: "worker exited " + (result.status ?? "signal"), receipt: failed }
  }

  const captured = captureCheckpoint({
    path: record.path,
    id: record.id,
    head: record.head,
    at: input.at,
  })
  if (!captured.ok) {
    const failed: Receipt = { ...receipt, status: "failed", exit: 0 }
    await writeReceipt({ id: input.id, receipt: failed, home: input.home })
    return {
      ok: false,
      reason: captured.error.step + ": " + captured.error.detail,
      receipt: failed,
    }
  }

  await consumeEvents({
    id: record.id,
    ids: receipt.events,
    home: input.home,
  })
  const done: Receipt = {
    ...receipt,
    status: "done",
    exit: 0,
    checkpoint: captured.value.sha,
  }
  await writeReceipt({ id: record.id, receipt: done, home: input.home })
  await writeWorkstream({
    record: {
      ...record,
      checkpoint: captured.value,
      updatedAt: input.at,
    },
    home: input.home,
  })
  return { ok: true, receipt: done, checkpoint: captured.value.sha }
}
