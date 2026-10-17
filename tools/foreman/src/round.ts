import { accountUsage, decide, type Budget } from "./budget.ts"
import { dispatchChild, MODEL_FREE, MODEL_GO, type ChildRun } from "./dispatch.ts"
import { Store, type Task } from "./store.ts"

/*
 * The round chain, made durable.
 *
 * §5: one round is a chain of durable tasks — census, triage, dispatch, witness, ratchet,
 * learn — that never terminates by reaching zero; it terminates by yielding to the budget and
 * resumes exactly where it stopped. This module is the chain's engine: a plan is seeded as
 * `pending` tasks, `runPending` dispatches them under the budget governor, and each result is
 * written back to the store so a crash resumes rather than repeats.
 *
 * Not every phase spends a conversation. `census`, `witness`-on-a-command, and `ratchet` are
 * in-process reads or commits; the plan still records them as tasks so the chain's position is
 * durable, and `runPending` skips anything whose `role` is `"self"` (the foreman's own work).
 */

export interface PlanTask {
  readonly requestId: string
  readonly phase: "census" | "triage" | "dispatch" | "witness" | "ratchet" | "learn"
  readonly role: string
  readonly prompt: string
  readonly worktree?: string
  readonly agent?: string
}

export interface Plan {
  readonly round: number
  readonly tasks: ReadonlyArray<PlanTask>
}

/** Seed a plan: upsert every task as `pending`, leaving any already-done task untouched. */
export const seedPlan = (store: Store, plan: Plan, now: number = Date.now()): number => {
  let added = 0
  for (const task of plan.tasks) {
    if (store.task(task.requestId) !== undefined) continue
    store.putTask({
      requestId: task.requestId,
      round: plan.round,
      phase: task.phase,
      role: task.role,
      status: "pending",
      prompt: task.prompt,
      ...(task.worktree === undefined ? {} : { worktree: task.worktree }),
      ...(task.agent === undefined ? {} : { agent: task.agent }),
      updatedAt: now,
    })
    added += 1
  }
  store.setDocument("plan", plan)
  return added
}

export interface RunOptions {
  readonly project: string
  readonly budget: Budget
  readonly model?: string
  readonly dryRun?: boolean
  readonly timeoutMs?: number
  readonly log?: (line: string) => void
}

export interface RunReport {
  readonly dispatched: ReadonlyArray<string>
  readonly stoppedBecause: string
}

/**
 * Dispatch the pending tasks a wave at a time, under the ceiling and the concurrency cap.
 * A task whose `role` is `"self"` is the foreman's own work and is marked done in place.
 */
export const runPending = async (store: Store, options: RunOptions): Promise<RunReport> => {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const model = options.model ?? MODEL_FREE
  const dispatched: string[] = []
  const fallback = MODEL_GO

  for (;;) {
    const pending = store.tasks().filter((task) => task.status === "pending")
    if (pending.length === 0) {
      return { dispatched, stoppedBecause: "no pending tasks" }
    }

    if (options.dryRun === true) {
      for (const task of pending)
        log(`would dispatch ${task.requestId} (${task.phase}/${task.role})`)
      return { dispatched: [], stoppedBecause: "dry run" }
    }

    const inflight = store.tasks().filter((task) => task.status === "running").length
    const verdict = decide(options.budget, accountUsage(options.project), inflight)
    if (!verdict.ok) {
      log(`yield: ${verdict.reason}`)
      return { dispatched, stoppedBecause: verdict.reason }
    }

    const wave = pending.slice(0, Math.max(1, options.budget.concurrency - inflight))
    for (const task of wave) {
      if (task.role === "self") {
        log(`self: ${task.requestId} (${task.phase}) — in-process`)
        store.putTask({ ...task, status: "done", result: "self", updatedAt: Date.now() })
        continue
      }
      log(`dispatch: ${task.requestId} (${task.phase}/${task.role})`)
      store.putTask({ ...task, status: "running", updatedAt: Date.now() })
    }

    const conversations = wave.filter((task) => task.role !== "self")
    const results = await Promise.all(
      conversations.map(async (task) => {
        const run = await dispatchChild({
          prompt: task.prompt,
          title: task.requestId,
          model,
          ...(task.agent === undefined ? {} : { agent: task.agent }),
          ...(task.worktree === undefined ? {} : { cwd: task.worktree }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        })
        return { task, run }
      }),
    )

    for (const { task, run } of results) {
      const finished: Task = {
        ...task,
        status: run.code === 0 ? "done" : "failed",
        ...(run.sessionID === "" ? {} : { session: run.sessionID }),
        result: run.text.trim(),
        updatedAt: Date.now(),
      }
      store.putTask(finished)
      dispatched.push(task.requestId)
      log(
        `${task.requestId}: ${finished.status} (${run.events} event(s), session ${run.sessionID || "none"})`,
      )
    }
    // One wave per call when the model fell through, so the caller can inspect and switch.
    if (model === MODEL_FREE && results.some((r) => r.run.code !== 0 && r.run.events === 0)) {
      log(`note: ${MODEL_FREE} produced no events — next dispatch should use ${fallback}`)
    }
  }
}

export type { ChildRun }
