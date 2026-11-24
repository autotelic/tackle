import { spawnSync } from "node:child_process"
import { raiseDesk } from "./desk.ts"
import { readWorkstream, writeWorkstream, type Workstream } from "./store.ts"

/** One declared gate's exact outcome, kept with the workstream that earned it. */
export interface GateResult {
  readonly name: string
  readonly command: string
  readonly exit: number
  readonly durationMs: number
  readonly output: string
}

export interface ReadyResult {
  readonly ok: boolean
  readonly checks: ReadonlyArray<GateResult>
  readonly reason?: string | undefined
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
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { ok: false, checks: [], reason: "WorkstreamNotFound" }
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
    await raiseDesk({
      home: input.home,
      item: {
        id,
        workstream: record.id,
        kind: "decision",
        title: "Landing gate failed",
        body:
          failed
            .map(
              (check) => check.name + " exited " + check.exit + ": " + check.output.slice(0, 800),
            )
            .join("\n\n") + "\n\nThe workstream stays in build. Fix the gate and run ready again.",
        choices: ["retry", "done"],
        route: "live",
        at: input.at,
      },
    })
  }
  return { ok, checks }
}
