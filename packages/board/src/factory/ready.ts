import { spawnSync } from "node:child_process"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { raiseDesk } from "./desk.ts"
import { appendEvent } from "./events.ts"
import { activityOf } from "./activity.ts"
import { receiptsDir } from "./kernel.ts"
import { landingLock, readWorkstream, writeWorkstream, type Workstream } from "./store.ts"
import { alive } from "@autotelic/room/run"

/** One declared gate's exact outcome, kept with the workstream that earned it. */
export type GateFailureKind = "ok" | "load-error" | "timeout" | "test-timeout" | "failed"

export interface GateResult {
  readonly name: string
  readonly command: string
  readonly exit: number
  readonly durationMs: number
  readonly output: string
  readonly failure: string
  readonly failureKind: GateFailureKind
  readonly failures: ReadonlyArray<string>
  readonly timeoutMs: number
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

const failureTitles = (output: string): ReadonlyArray<string> => {
  const lines = output.split("\n")
  const titles: Array<string> = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (/^\d+\)\s+\S/u.test(line)) {
      const next = lines[index + 1]?.trim() ?? ""
      titles.push(
        next === "" || /^(AssertionError|Error|TypeError|ReferenceError):/u.test(next)
          ? line
          : line + " — " + next,
      )
      continue
    }
    if (
      /^(FAIL|✗)\b/u.test(line) ||
      /^(AssertionError|Error|TypeError|ReferenceError):\s/u.test(line)
    )
      titles.push(line)
  }
  return [...new Set(titles)].slice(0, 24)
}

const failureKind = (exit: number, output: string): GateFailureKind => {
  if (exit === 0) return "ok"
  if (
    /(SyntaxError|Cannot find module|does not provide an export|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)/iu.test(
      output,
    )
  )
    return "load-error"
  if (/Timeout of \d+ms exceeded/iu.test(output)) return "test-timeout"
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
    // The suite can print well over the 1 MB default; a full mocha block has to survive the
    // buffer or readiness cannot name the failing test.
    maxBuffer: 256 * 1024 * 1024,
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
    failureKind:
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
        ? "timeout"
        : failureKind(result.status ?? -1, output),
    failures: failureTitles(output),
    timeoutMs: input.timeoutMs,
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
  await writeFile(lock, JSON.stringify({ pid: process.pid, at: input.at, workstream: input.id }))
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
  const activity = await activityOf({ record, home: input.home, now: Date.parse(input.at) })
  if (activity.state === "working")
    return {
      ok: false,
      checks: [],
      reason: "ReadyBlocked: pass running on " + record.id,
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
  if (record.delivery === "pr" && record.pr !== undefined) {
    const body = spawnSync(
      process.env.GH_BIN ?? "gh",
      ["pr", "view", String(record.pr), "--repo", record.repo, "--json", "body"],
      { cwd: record.path, encoding: "utf8" },
    )
    if (body.status !== 0)
      return { ok: false, checks: [], reason: "PrBodyUnreadable: cannot read PR #" + record.pr }
    const decoded = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(body.stdout)
    const text =
      Result.isSuccess(decoded) && typeof decoded.success === "object" && decoded.success !== null
        ? (decoded.success as { readonly body?: unknown }).body
        : undefined
    const description = typeof text === "string" ? text : ""
    const missing = ["## Summary", "## The walkthrough", "## For the code review"].filter(
      (heading) => !description.includes(heading),
    )
    const hasVisual =
      /!\[[^\]]*\]\([^)]+\)/u.test(description) ||
      /<img\s/iu.test(description) ||
      /(user-attachments|private-user-images|raw\.githubusercontent\.com)/u.test(description)
    const visualPending =
      /captures?\s+(are\s+)?(not attached|pending)/iu.test(description) ||
      /visuals?\s+(are\s+)?(not attached|pending)/iu.test(description)
    if (description.trim().length < 1200 || missing.length > 0 || (!hasVisual && !visualPending))
      return {
        ok: false,
        checks: [],
        reason:
          "PrBodyRequired: the PR description must follow the #1862 handoff shape" +
          (missing.length === 0 ? "" : " (missing " + missing.join(", ") + ")") +
          (hasVisual || visualPending
            ? " and be substantive"
            : " and either show a visual or say why captures are pending"),
      }
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
      readiness: { at: input.at, ok, checks, head: record.head },
      updatedAt: input.at,
    },
  })
  const readyKey = String(record.pr ?? "trunk") + "-" + record.head.slice(0, 12)
  const id = "desk-" + record.id + (ok ? "-ready-" + readyKey : "-gate-" + Date.parse(input.at))
  if (ok) {
    const marked =
      record.delivery === "pr" && record.pr !== undefined
        ? spawnSync(
            process.env.GH_BIN ?? "gh",
            ["pr", "ready", String(record.pr), "--repo", record.repo],
            {
              cwd: record.path,
              encoding: "utf8",
            },
          )
        : undefined
    await raiseDesk({
      home: input.home,
      item: {
        id,
        workstream: record.id,
        kind: "decision",
        title: "Ready for review PR #" + String(record.pr ?? ""),
        body:
          "Every onReady gate passed at the landing head. The PR is ready for human review; merging is a separate human act." +
          (marked === undefined || marked.status === 0
            ? ""
            : "\n\nThe PR could not be marked ready for review: " +
              (marked.stderr ?? marked.stdout ?? "")),
        choices: ["done", "continue"],
        route: "live",
        at: input.at,
      },
    })
  } else {
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
          (check.failureKind === "timeout"
            ? "\n  timed out after " +
              Math.round(check.durationMs / 1000) +
              "s (cap " +
              Math.round(check.timeoutMs / 1000) +
              "s)"
            : "") +
          "\n  " +
          (check.failures.length === 0
            ? check.failure
            : "Failing tests:\n" + check.failures.map((title) => "  " + title).join("\n")),
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
