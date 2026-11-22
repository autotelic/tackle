import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Match } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { captureCheckpoint } from "./adopt.ts"
import { consumeEvents, readEvents, type Event } from "./events.ts"
import { snapshotJournal } from "./journal.ts"
import {
  factoryHome,
  readWorkstream,
  workstreamDir,
  writeWorkstream,
  type Workstream,
} from "./store.ts"

/** One pass's receipt; written before the worker starts because the pass is charged then. */
export interface Quality {
  readonly available: boolean
  readonly errors: number
  readonly warnings: number
  readonly note: string
}

export interface Receipt {
  readonly workstream: string
  readonly pass: number
  readonly at: string
  readonly status: "running" | "done" | "failed"
  readonly phase: Workstream["phase"]
  readonly events: ReadonlyArray<string>
  readonly checkpoint: string | undefined
  readonly exit: number | undefined
  readonly pid?: number | undefined
  readonly quality?: {
    readonly before: Quality
    readonly after: Quality
    readonly regressed: boolean
  }
  readonly journal?: string
}

const JigReport = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ severity: Schema.String })),
})

const measureQuality = (input: { readonly path: string }): Quality => {
  const local = join(input.path, "node_modules", ".bin", "jig")
  const command = existsSync(local) ? local : "jig"
  const result = spawnSync(command, ["check", "--format", "json"], {
    cwd: input.path,
    encoding: "utf8",
    timeout: 120_000,
  })
  if (result.error !== undefined)
    return { available: false, errors: 0, warnings: 0, note: String(result.error) }
  const decoded = Schema.decodeResult(Schema.fromJsonString(JigReport))(result.stdout)
  if (Result.isFailure(decoded))
    return {
      available: false,
      errors: 0,
      warnings: 0,
      note: "jig output did not decode (exit " + result.status + ")",
    }
  let errors = 0
  let warnings = 0
  for (const diagnostic of decoded.success.diagnostics) {
    if (diagnostic.severity === "error") errors += 1
    if (diagnostic.severity === "warn") warnings += 1
  }
  return { available: true, errors, warnings, note: "jig check" }
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

/**
 * Count the charged passes for a workstream from its receipts.
 *
 * @param input - the workstream id and optional home.
 * @returns the number of receipts, including interrupted passes.
 */
export const passesUsed = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<number> =>
  (await readdir(receiptsDir(input)).catch(() => [])).filter((name) => name.endsWith(".json"))
    .length

const RunningReceipt = Schema.Struct({
  pass: Schema.Finite,
  status: Schema.String,
  pid: Schema.optional(Schema.Finite),
})

const alive = (pid: number): boolean => {
  // SAFETY: signalling a PID is a process boundary; ESRCH is the expected absence.
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A pass already running in this home, if its receipt's process is alive. */
const runningPass = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<number | undefined> => {
  const names = (await readdir(receiptsDir(input)).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  )
  for (const name of names.sort((left, right) => left.localeCompare(right)).reverse()) {
    const text = await readFile(join(receiptsDir(input), name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(RunningReceipt))(text)
    if (Result.isFailure(decoded) || decoded.success.status !== "running") continue
    if (decoded.success.pid !== undefined && alive(decoded.success.pid)) return decoded.success.pass
  }
  return undefined
}

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
    Match.value(input.record.phase).pipe(
      Match.when(
        "reconcile",
        () =>
          "This is read-only reconciliation: inspect the Linear project, its issues, the branch and PR. Do not edit code, Linear, or the SOW. Write a reconciliation report with per-issue evidence and states done/refused/remaining/unknown to $FACTORY_REPORT_DIR/<workstream>-reconcile.json, then stop.",
      ),
      Match.when(
        "land",
        () =>
          "This is a land pass: make the PR mergeable (conflicts, checks, description, reviewers). Do not merge, edit the SOW, or open another PR.",
      ),
      Match.orElse(
        () =>
          "Work the project in this phase. Do not merge, edit the SOW, or touch another workstream.",
      ),
    ),
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
  readonly eventIds?: ReadonlyArray<string>
}): Promise<PassOutcome> => {
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { ok: false, reason: "WorkstreamNotFound" }
  if (record.phase === "done") return { ok: false, reason: "WorkstreamDone" }
  if (record.phase === "blocked") return { ok: false, reason: "WorkstreamBlocked" }

  const used = await passesUsed({ id: input.id, home: input.home })
  if (used >= record.budgets.passesPerPhase)
    return { ok: false, reason: "budget: passesPerPhase " + record.budgets.passesPerPhase }
  const alreadyRunning = await runningPass({ id: input.id, home: input.home })
  if (alreadyRunning !== undefined)
    return { ok: false, reason: "PassRunning: pass " + alreadyRunning }

  const only = input.eventIds === undefined ? undefined : new Set(input.eventIds)
  const events = (await readEvents({ id: input.id, home: input.home })).filter(
    (event) => event.status === "pending" && (only === undefined || only.has(event.id)),
  )
  if (events.length === 0) return { ok: false, reason: "NoPendingEvents" }

  const pass = used + 1
  const startHeadResult = spawnSync("git", ["-C", record.path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  })
  const startHead = startHeadResult.status === 0 ? startHeadResult.stdout.trim() : record.head
  const before = measureQuality({ path: record.path })
  const receipt: Receipt = {
    workstream: record.id,
    pass,
    at: input.at,
    status: "running",
    phase: record.phase,
    events: events.map((event) => event.id),
    checkpoint: undefined,
    exit: undefined,
    pid: process.pid,
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
      FACTORY_REPORT_DIR: join(factoryHome(), "reports"),
      FACTORY_PROMPT: promptOf({ record, events }),
    },
  })

  if (result.status !== 0) {
    const journal = await snapshotJournal({
      id: record.id,
      pass,
      at: input.at,
      status: "failed",
      home: input.home,
    })
    const failed: Receipt = {
      ...receipt,
      status: "failed",
      exit: result.status ?? -1,
      journal,
    }
    await writeReceipt({ id: input.id, receipt: failed, home: input.home })
    return { ok: false, reason: "worker exited " + (result.status ?? "signal"), receipt: failed }
  }

  const after = measureQuality({ path: record.path })
  const regressed = after.errors > before.errors || after.warnings > before.warnings
  const head = spawnSync("git", ["-C", record.path, "rev-parse", "HEAD"], { encoding: "utf8" })
  const currentHead = head.status === 0 ? head.stdout.trim() : record.head
  const changed = (() => {
    const diff = spawnSync(
      "git",
      ["-C", record.path, "diff", "--name-only", startHead + ".." + currentHead],
      {
        encoding: "utf8",
      },
    )
    const status = spawnSync("git", ["-C", record.path, "status", "--porcelain"], {
      encoding: "utf8",
    })
    const files = new Set<string>()
    for (const line of (diff.stdout ?? "").split("\n"))
      if (line.trim() !== "") files.add(line.trim())
    for (const line of (status.stdout ?? "").split("\n"))
      if (line.length > 3) files.add(line.slice(3).trim())
    return [...files]
  })()
  const protectedTouched = changed.filter((file) =>
    (record.protectedPaths ?? []).some((pattern) =>
      pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -3)) : file === pattern,
    ),
  )

  const captured = captureCheckpoint({
    path: record.path,
    id: record.id,
    head: currentHead,
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

  if (protectedTouched.length > 0) {
    const journal = await snapshotJournal({
      id: record.id,
      pass,
      at: input.at,
      status: "failed",
      home: input.home,
    })
    const failed: Receipt = {
      ...receipt,
      status: "failed",
      exit: 0,
      checkpoint: captured.value.sha,
      journal,
    }
    await writeReceipt({ id: record.id, receipt: failed, home: input.home })
    await writeWorkstream({
      record: {
        ...record,
        phase: "blocked",
        head: currentHead,
        checkpoint: captured.value,
        updatedAt: input.at,
      },
      home: input.home,
    })
    return { ok: false, reason: "gate-protected: " + protectedTouched.join(", "), receipt: failed }
  }

  if (regressed) {
    const journal = await snapshotJournal({
      id: record.id,
      pass,
      at: input.at,
      status: "failed",
      home: input.home,
    })
    const failed: Receipt = {
      ...receipt,
      status: "failed",
      exit: 0,
      checkpoint: captured.value.sha,
      quality: { before, after, regressed },
      journal,
    }
    await writeReceipt({ id: record.id, receipt: failed, home: input.home })
    return { ok: false, reason: "quality-regressed", receipt: failed }
  }

  await consumeEvents({
    id: record.id,
    ids: receipt.events,
    home: input.home,
  })
  const journal = await snapshotJournal({
    id: record.id,
    pass,
    at: input.at,
    status: "done",
    home: input.home,
  })
  const done: Receipt = {
    ...receipt,
    status: "done",
    exit: 0,
    checkpoint: captured.value.sha,
    quality: { before, after, regressed },
    journal,
  }
  await writeReceipt({ id: record.id, receipt: done, home: input.home })
  await writeWorkstream({
    record: {
      ...record,
      head: currentHead,
      checkpoint: captured.value,
      updatedAt: input.at,
    },
    home: input.home,
  })
  return { ok: true, receipt: done, checkpoint: captured.value.sha }
}
