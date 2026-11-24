import { spawnSync } from "node:child_process"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { raiseDesk } from "./desk.ts"
import { appendEvent } from "./events.ts"
import { activityOf } from "./activity.ts"
import { receiptsDir } from "./kernel.ts"
import {
  landingLock,
  listWorkstreams,
  readWorkstream,
  writeWorkstream,
  type Workstream,
} from "./store.ts"
import { alive } from "@autotelic/room/run"

/** One declared gate's exact outcome, kept with the workstream that earned it. */
export type GateFailureKind = "ok" | "load-error" | "failed"

export interface GateResult {
  readonly name: string
  readonly command: string
  readonly exit: number
  readonly durationMs: number
  readonly output: string
  readonly failure: string
  readonly failureKind: GateFailureKind
}

export interface ReadyResult {
  readonly ok: boolean
  readonly checks: ReadonlyArray<GateResult>
  readonly reason?: string | undefined
}

const CompressionProof = Schema.Struct({
  findingsBefore: Schema.Finite,
  findingsAfter: Schema.Finite,
  consolidated: Schema.Finite,
  deleted: Schema.Finite,
  locNet: Schema.Finite,
  effectBefore: Schema.Struct({
    bespokeErrorUnion: Schema.Finite,
    throwCount: Schema.Finite,
    dateNow: Schema.Finite,
    consoleLog: Schema.Finite,
  }),
  effectAfter: Schema.Struct({
    bespokeErrorUnion: Schema.Finite,
    throwCount: Schema.Finite,
    dateNow: Schema.Finite,
    consoleLog: Schema.Finite,
  }),
  ruleGaps: Schema.Array(Schema.String),
})

const CompressionReceipt = Schema.Struct({
  phase: Schema.optional(Schema.String),
  compress: Schema.optional(Schema.Unknown),
})

const hasCompressionProof = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<boolean> => {
  const names = (await readdir(receiptsDir(input)).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  )
  for (const name of names.sort((left, right) => right.localeCompare(left))) {
    const text = await readFile(join(receiptsDir(input), name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(CompressionReceipt))(text)
    if (Result.isFailure(decoded)) continue
    if (decoded.success.phase !== "compress" || decoded.success.compress === undefined) continue
    const proof = Schema.decodeUnknownResult(CompressionProof)(decoded.success.compress)
    if (Result.isSuccess(proof)) return true
  }
  return false
}

const failureKind = (exit: number, output: string): GateFailureKind => {
  if (exit === 0) return "ok"
  if (
    /(SyntaxError|Cannot find module|does not provide an export|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)/iu.test(
      output,
    )
  )
    return "load-error"
  return "failed"
}

const failureExcerpt = (output: string): string => {
  const lines = output.split("\n")
  const interesting = lines.filter((line) =>
    /(fail|error|assert|✗|not ok|failing|expected)/iu.test(line),
  )
  return (interesting.length === 0 ? lines : interesting).slice(0, 16).join("\n").slice(0, 1400)
}

const runGate = (input: {
  readonly workstream: Workstream
  readonly gate: { readonly name: string; readonly command: string }
  readonly timeoutMs: number
}): GateResult => {
  const started = Date.now()
  const result = spawnSync("sh", ["-c", input.gate.command], {
    cwd: input.workstream.path,
    encoding: "utf8",
    timeout: input.timeoutMs,
  })
  const output = ((result.stdout ?? "") + (result.stderr ?? "")).trim()
  return {
    name: input.gate.name,
    command: input.gate.command,
    exit: result.status ?? -1,
    durationMs: Date.now() - started,
    output: output.slice(-4000),
    failure: failureExcerpt(output),
    failureKind: failureKind(result.status ?? -1, output),
  }
}

/**
 * Run the declared landing gates once, at the PR's real head. This is intentionally not part
 * of a pass: conformance is a landing gate, while the pass gate is the change's touched test.
 */
export const runReady = async (input: {
  readonly id: string
  readonly at: string
  readonly home?: string | undefined
  readonly timeoutMs?: number | undefined
}): Promise<ReadyResult> => {
  const lock = landingLock(input.home)
  const held = await readFile(lock, "utf8").catch(() => undefined)
  const heldPid = held === undefined ? NaN : Number(held)
  if (Number.isFinite(heldPid) && heldPid !== process.pid && alive(heldPid))
    return { ok: false, checks: [], reason: "ReadyBlocked: landing already running in " + heldPid }
  await writeFile(lock, String(process.pid))
  try {
    return await runReadyInner(input)
  } finally {
    await rm(lock, { force: true })
  }
}

const runReadyInner = async (input: {
  readonly id: string
  readonly at: string
  readonly home?: string | undefined
  readonly timeoutMs?: number | undefined
}): Promise<ReadyResult> => {
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { ok: false, checks: [], reason: "WorkstreamNotFound" }
  const activities = await Promise.all(
    (await listWorkstreams({ home: input.home })).map((candidate) =>
      activityOf({ record: candidate, home: input.home, now: Date.parse(input.at) }),
    ),
  )
  const busy = activities.find((activity) => activity.state === "working")
  if (busy !== undefined)
    return {
      ok: false,
      checks: [],
      reason: "ReadyBlocked: pass running on " + busy.workstream,
    }
  if (record.phase === "reconcile" || record.phase === "build")
    return {
      ok: false,
      checks: [],
      reason: "CompressRequired: set phase compress and run the compression pass before ready",
    }
  if (!(await hasCompressionProof({ id: record.id, home: input.home })))
    return {
      ok: false,
      checks: [],
      reason:
        "CompressionProofRequired: a compress receipt must carry findingsBefore, findingsAfter, consolidated, deleted, locNet, and ruleGaps",
    }
  const gates = record.gates?.onReady ?? []
  if (gates.length === 0)
    return { ok: false, checks: [], reason: "NoOnReadyGates: declare gates.onReady" }
  const checks = gates.map((gate) =>
    runGate({ workstream: record, gate, timeoutMs: input.timeoutMs ?? 900_000 }),
  )
  const ok = checks.every((check) => check.exit === 0)
  await writeWorkstream({
    home: input.home,
    record: {
      ...record,
      phase: ok ? "land" : record.phase,
      readiness: { at: input.at, ok, checks },
      updatedAt: input.at,
    },
  })
  const id = "desk-" + record.id + (ok ? "-ready-" : "-gate-") + Date.parse(input.at)
  if (ok)
    await raiseDesk({
      home: input.home,
      item: {
        id,
        workstream: record.id,
        kind: "decision",
        title: "Ready to merge PR #" + String(record.pr ?? ""),
        body: "Every onReady gate passed at the landing head. Answer done to retire, or continue to keep building.",
        choices: ["done", "continue"],
        route: "live",
        at: input.at,
      },
    })
  else {
    const failed = checks.filter((check) => check.exit !== 0)
    const task = [
      "Landing gate failed. Fix only these failures, then commit, push, and stop.",
      "Do not run the gates in this build pass; `factory ready` will re-run them.",
      "",
      ...failed.map(
        (check) =>
          "- " +
          check.name +
          " (exit " +
          check.exit +
          ", " +
          check.failureKind +
          "): " +
          check.command +
          "\n  " +
          check.failure,
      ),
    ].join("\n")
    await appendEvent({
      id: record.id,
      home: input.home,
      event: {
        id: "ready-fix-" + Date.parse(input.at),
        kind: "task",
        at: input.at,
        payload: { task },
        status: "pending",
      },
    })
  }
  return { ok, checks }
}
