import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { alive } from "@autotelic/room/run"
import { Match } from "effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { captureCheckpoint } from "./adopt.ts"
import { branchGuard } from "./branch.ts"
import { raiseDesk } from "./desk.ts"
import { appendEvent, consumeEvents, readEvents, type Event } from "./events.ts"
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

type CaptureResult = {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

const runCapture = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly timeout: number },
): Promise<CaptureResult> =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: CaptureResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({ status: null, stdout, stderr, error: new Error("ETIMEDOUT") })
    }, options.timeout)
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => finish({ status: null, stdout, stderr, error }))
    child.on("close", (status) => finish({ status, stdout, stderr }))
  })

const measureQuality = async (input: { readonly path: string }): Promise<Quality> => {
  const local = join(input.path, "node_modules", ".bin", "jig")
  const command = existsSync(local) ? local : "jig"
  const result = await runCapture(command, ["check", "--format", "json"], {
    cwd: input.path,
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

const eventState = (event: Event): Option.Option<string> => {
  const decoded = Schema.decodeUnknownResult(Schema.Struct({ state: Schema.String }))(event.payload)
  return Result.isSuccess(decoded) ? Option.some(decoded.success.state) : Option.none()
}

/**
 * A pass that improved local quality but is not at zero asks for another pass. A pass that
 * did not improve does not loop: it raises a desk item instead, so a human decides whether
 * to keep spending passes. A pass at zero is silent here; the check event opens the merge
 * handoff.
 */
export const followUpEvent = (input: {
  readonly record: Workstream
  readonly receipt: Receipt
  readonly events: ReadonlyArray<Event>
}): ReadonlyArray<Event> => {
  const noFollowUp: ReadonlyArray<Event> = []
  const quality = input.receipt.quality
  if (quality === undefined || !quality.after.available) return noFollowUp
  if (quality.after.errors === 0) return noFollowUp
  const improved =
    quality.after.errors < quality.before.errors ||
    (quality.after.errors === quality.before.errors &&
      quality.after.warnings < quality.before.warnings)
  if (!improved) return noFollowUp
  return [
    {
      id:
        "quality:" +
        input.record.id +
        ":" +
        input.receipt.pass +
        ":" +
        quality.after.errors +
        ":" +
        quality.after.warnings,
      kind: "quality",
      at: input.receipt.at,
      payload: {
        pass: input.receipt.pass,
        errors: quality.after.errors,
        warnings: quality.after.warnings,
        note: quality.after.note,
      },
      status: "pending",
    },
  ]
}

/** A green check plus a clean local gate is the explicit point where a human can land. */
export const readyForHuman: Predicate.Predicate<{
  readonly record: Workstream
  readonly receipt: Receipt
  readonly events: ReadonlyArray<Event>
}> = (input) => {
  const quality = input.receipt.quality?.after
  return (
    quality !== undefined &&
    quality.available &&
    quality.errors === 0 &&
    input.record.delivery === "pr" &&
    input.record.pr !== undefined &&
    input.events.some((event) => {
      const state = eventState(event)
      return event.kind === "check" && Option.isSome(state) && state.value === "passed"
    })
  )
}

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

/** Whether a path a pass changed matches one of the record's protected patterns. */
export const isProtectedPath: Predicate.Predicate<{
  readonly record: Workstream
  readonly path: string
}> = (input) =>
  (input.record.protectedPaths ?? []).some((pattern) =>
    pattern.endsWith("/**")
      ? input.path.startsWith(pattern.slice(0, -3) + "/")
      : input.path === pattern,
  )

const hcBinary = (): Option.Option<string> => {
  if (process.env.HC_BIN !== undefined && process.env.HC_BIN !== "")
    return Option.some(process.env.HC_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "hc")
    if (existsSync(candidate)) return Option.some(candidate)
  }
  const local = join(homedir(), ".local", "bin", "hc")
  return existsSync(local) ? Option.some(local) : Option.none()
}

const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"

type ProcessResult = {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

/** Spawn a foreground process without blocking the daemon loop. */
const runProcess = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly timeout: number
    readonly shell?: boolean
  },
): Promise<ProcessResult> =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      stdio: "inherit",
    })
    let settled = false
    const finish = (result: ProcessResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({ status: null, signal: "SIGTERM", error: new Error("ETIMEDOUT") })
    }, options.timeout)
    child.on("error", (error) => finish({ status: null, signal: null, error }))
    child.on("close", (status, signal) => finish({ status, signal }))
  })

/**
 * Run the worker inside a Herdr terminal when hc is available. The terminal carries
 * the workstream label, so the factory panel can focus the live pass instead of guessing.
 */
const runInTerminal = async (input: {
  readonly record: Workstream
  readonly pass: number
  readonly worker: string
  readonly env: NodeJS.ProcessEnv
  readonly wallMs: number
}) => {
  const hc = hcBinary()
  if (Option.isNone(hc)) return undefined
  const directory = join(factoryHome(), "workers")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const script = join(directory, input.record.id + "-" + input.pass + ".sh")
  const exports = Object.entries(input.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => "export " + key + "=" + shellQuote(value))
    .join("\n")
  await writeFile(script, "#!/bin/sh\n" + exports + "\nexec " + input.worker + "\n", {
    mode: 0o700,
  })
  const name = ("factory-" + input.record.id + "-" + input.pass).slice(0, 32)
  return runProcess(
    hc.value,
    [
      "run",
      "--name",
      name,
      "--label",
      "workstream=" + input.record.id,
      "--label",
      "factory=worker",
      "--cwd",
      input.record.path,
      "--no-parent",
      "--timeout",
      String(Math.ceil(input.wallMs / 1000) + 10),
      "--",
      script,
    ],
    { cwd: input.record.path, env: input.env, timeout: input.wallMs },
  )
}

/** The intercom CLI installed beside Pi; an operator can override it for another machine. */
const intercomCli = (): string =>
  process.env.PI_INTERCOM_CLI ?? join(homedir(), ".pi/agent/npm/node_modules/pi-intercom/cli.mjs")

/**
 * Deliver a pass to a live Pi session and wait for its reply.
 *
 * The session has no shell exit of its own, so the ask timeout becomes the pass's
 * blocked-on-human exit (2). The timeout leaves time for the quality gate under the
 * workstream's wall-clock budget.
 */
const runIntercom = async (input: {
  readonly record: Workstream
  readonly session: string
  readonly prompt: string
  readonly env: NodeJS.ProcessEnv
  readonly wallMs: number
}) =>
  runProcess(
    process.execPath,
    [
      intercomCli(),
      "ask",
      "--to",
      input.session,
      "--json",
      "--timeout-ms",
      String(Math.max(1_000, input.wallMs - 300_000)),
      "--text",
      "Work in " + input.record.path + ". Do not edit another worktree.\n\n" + input.prompt,
    ],
    { cwd: input.record.path, env: input.env, timeout: input.wallMs },
  )

/**
 * Run one pass over the pending events. The pass is charged when it starts, not when it ends.
 *
 * @param input - the workstream, the worker command, and the timestamp.
 * @returns the receipt and checkpoint, or the refusal.
 */
interface RunPassInput {
  readonly id: string
  readonly worker?: string | undefined
  readonly at: string
  readonly home?: string | undefined
  readonly eventIds?: ReadonlyArray<string>
}

const passLock = (input: { readonly id: string; readonly home?: string | undefined }): string =>
  join(workstreamDir(input.home), input.id + ".pass.lock")

/** Acquire the per-workstream pass lock; a live holder is a refusal, a dead one is stale. */
const acquirePassLock = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<number | undefined> => {
  const path = passLock(input)
  await mkdir(workstreamDir(input.home), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquired = await writeFile(path, String(process.pid), { flag: "wx" }).then(
      () => true,
      () => false,
    )
    if (acquired) return undefined
    const text = await readFile(path, "utf8").catch(() => undefined)
    const pid = text === undefined ? NaN : Number(text)
    if (Number.isFinite(pid) && alive(pid)) return pid
    await rm(path, { force: true })
  }
  return process.pid
}

const runPassInner = async (input: RunPassInput): Promise<PassOutcome> => {
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { ok: false, reason: "WorkstreamNotFound" }
  if (record.phase === "done") return { ok: false, reason: "WorkstreamDone" }
  if (record.phase === "blocked") return { ok: false, reason: "WorkstreamBlocked" }

  // The lease stops a second pass, not a hand session: HEAD can be switched under a worktree
  // between adopt and a pass. Refuse before the receipt exists, so a pass that could not have
  // run is not charged and its events stay pending for whoever fixes the branch.
  const guard = await branchGuard({ path: record.path, record, home: input.home })
  if (guard._tag === "Mismatch") return { ok: false, reason: guard.reason }

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
  const worker = record.worker ?? input.worker
  if (worker === undefined)
    return { ok: false, reason: "NoWorker: set the workstream worker or pass --worker" }

  const pass = used + 1
  const startHeadResult = spawnSync("git", ["-C", record.path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  })
  const startHead = startHeadResult.status === 0 ? startHeadResult.stdout.trim() : record.head
  const before = await measureQuality({ path: record.path })
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

  const wallMs = record.budgets.wallMinutesPerPass * 60_000
  const workerEnv = {
    ...process.env,
    // The worker is an agent this factory creates. Low thinking is the default; a Pi
    // worker must pass it to `pi --thinking` because this env is a descriptor, not a flag.
    FACTORY_THINKING: "low",
    PI_REASONING_LEVEL: "low",
    FACTORY_WORKSTREAM: record.id,
    FACTORY_PROJECT: record.project,
    FACTORY_PHASE: record.phase,
    FACTORY_EVENTS: JSON.stringify(events),
    FACTORY_REPORT_DIR: join(factoryHome(), "reports"),
    FACTORY_PROMPT: promptOf({ record, events }),
  }
  const result = worker.startsWith("intercom:")
    ? await runIntercom({
        record,
        session: worker.slice("intercom:".length),
        prompt: workerEnv.FACTORY_PROMPT ?? "",
        env: workerEnv,
        wallMs,
      })
    : ((await runInTerminal({
        record,
        pass,
        worker,
        env: workerEnv,
        wallMs,
      })) ??
      (await runProcess(worker, [], {
        cwd: record.path,
        shell: true,
        timeout: wallMs,
        env: workerEnv,
      })))

  if (result.status === 2) {
    const journal = await snapshotJournal({
      id: record.id,
      pass,
      at: input.at,
      status: "failed",
      home: input.home,
    })
    const blockedReceipt: Receipt = {
      ...receipt,
      status: "failed",
      exit: 2,
      journal,
    }
    await writeReceipt({ id: input.id, receipt: blockedReceipt, home: input.home })
    await writeWorkstream({
      record: { ...record, phase: "blocked", updatedAt: input.at },
      home: input.home,
    })
    await raiseDesk({
      item: {
        id: "desk-" + record.id + "-blocked-" + pass,
        workstream: record.id,
        kind: "decision",
        title: "Pass #" + pass + " needs a human",
        body: "The worker exited 2 (blocked-on-human). Answer resume to retry the event, or defer to leave the workstream blocked.",
        choices: ["resume", "defer"],
        route: "live",
        at: input.at,
      },
      home: input.home,
    })
    return { ok: false, reason: "blocked-on-human", receipt: blockedReceipt }
  }

  if (result.status !== 0) {
    const timedOut =
      result.signal === "SIGTERM" || (result.error?.message ?? "").includes("ETIMEDOUT")
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
    return {
      ok: false,
      reason: timedOut
        ? "WorkerTimeout: wallMinutesPerPass " + record.budgets.wallMinutesPerPass
        : "worker exited " + (result.status ?? "signal"),
      receipt: failed,
    }
  }

  const after = await measureQuality({ path: record.path })
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
  const protectedTouched = changed.filter((file) => isProtectedPath({ record, path: file }))

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
    await raiseDesk({
      item: {
        id: "desk-" + record.id + "-gate-" + pass,
        workstream: record.id,
        kind: "decision",
        title: "Unblock pass #" + pass + "?",
        body:
          "The pass touched protected paths: " +
          protectedTouched.join(", ") +
          ". Resume to keep the change and run the next pass, or defer to leave the workstream blocked.",
        choices: ["resume", "defer"],
        route: "live",
        at: input.at,
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

  const [followUp] = followUpEvent({ record, receipt: done, events })
  if (followUp !== undefined)
    await appendEvent({ id: record.id, event: followUp, home: input.home })

  const afterQuality = done.quality?.after
  if (
    followUp === undefined &&
    afterQuality !== undefined &&
    afterQuality.available &&
    afterQuality.errors > 0
  )
    await raiseDesk({
      item: {
        id: "desk-" + record.id + "-stalled-" + pass,
        workstream: record.id,
        kind: "decision",
        title: "Quality did not improve in pass #" + pass,
        body:
          "The pass left " +
          afterQuality.errors +
          " errors and " +
          afterQuality.warnings +
          " warnings, with no improvement over the start. Continue to spend another pass, or done to retire.",
        choices: ["continue", "done"],
        route: "live",
        at: input.at,
      },
      home: input.home,
    })

  if (readyForHuman({ record, receipt: done, events })) {
    await raiseDesk({
      item: {
        id: "desk-" + record.id + "-ready-" + pass,
        workstream: record.id,
        kind: "decision",
        title: "Ready to merge PR #" + record.pr,
        body:
          "Pass " +
          pass +
          " finished with 0 errors and " +
          (done.quality?.after.warnings ?? 0) +
          " warnings at " +
          captured.value.sha.slice(0, 8) +
          ". Answer done to retire this workstream, or continue to keep it active.",
        choices: ["done", "continue"],
        route: "live",
        at: input.at,
      },
      home: input.home,
    })
  }

  return { ok: true, receipt: done, checkpoint: captured.value.sha }
}

/**
 * Run one pass with the workstream's pass lock held.
 *
 * @param input - the workstream id, the worker, the instant the pass started, and its budget.
 * @returns the pass outcome, or a refusal when a live pass already holds the lock.
 */
export const runPass = async (input: RunPassInput): Promise<PassOutcome> => {
  const held = await acquirePassLock({ id: input.id, home: input.home })
  if (held !== undefined) return { ok: false, reason: "PassRunning: lock held by " + held }
  // SAFETY: the lock is a file a second process reads, so it must go on the throwing path too.
  // Nothing is caught here: the pass's failure travels on, and only the release is guaranteed.
  try {
    return await runPassInner(input)
  } finally {
    await rm(passLock(input), { force: true })
  }
}
