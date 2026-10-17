import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { accountUsage, decide, readBudget } from "./budget.ts"
import { dispatchChild, MODEL_FREE, MODEL_GO } from "./dispatch.ts"
import { runPending, seedPlan, type Plan } from "./round.ts"
import { Store } from "./store.ts"

/*
 * `node tools/foreman/main.ts <command>` — the foreman's durable front door.
 *
 *   status    what the last round left behind, and whether the budget allows more
 *   seed      load a plan document and record its tasks as `pending`
 *   run       dispatch the pending chain until the budget yields
 *   dispatch  run exactly one conversation, now
 *
 * The store is one SQLite file beside this program; the journal stays the human-readable
 * checkpoint (§10). Nothing here reaches for a model except `dispatch` and `run`, and both
 * ask the budget governor first.
 */

const DB_PATH = "tools/foreman/foreman.sqlite"
const BUDGET_PATH = "tools/foreman/budget.json"

const usage = (): void => {
  process.stdout.write(
    [
      "foreman — the durable round chain",
      "",
      "  node tools/foreman/main.ts status",
      "  node tools/foreman/main.ts seed --file <plan.json>",
      "  node tools/foreman/main.ts run [--dry-run] [--model <id>]",
      "  node tools/foreman/main.ts dispatch --request-id <id> --phase <p> --role <r> --prompt <text> [--worktree <dir>]",
      "",
    ].join("\n"),
  )
}

const status = (store: Store): void => {
  const budget = readBudget(BUDGET_PATH)
  const usageNow = accountUsage(".")
  const tasks = store.tasks()
  const byStatus = new Map<string, number>()
  for (const task of tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1)
  process.stdout.write(
    `tasks: ${tasks.length} (${[...byStatus].map(([s, n]) => `${s}=${n}`).join(" ") || "none"})\n`,
  )
  const interrupted = store.interrupted()
  if (interrupted.length > 0) {
    process.stdout.write(`\nINTERRUPTED (reported, never auto-repeated):\n`)
    for (const task of interrupted)
      process.stdout.write(`  ${task.requestId} (${task.phase}/${task.role})\n`)
  }
  if (budget === undefined) {
    process.stdout.write("\nbudget: none committed (tools/foreman/budget.json)\n")
    return
  }
  const verdict = decide(
    budget,
    usageNow,
    store.tasks().filter((t) => t.status === "running").length,
  )
  process.stdout.write(
    `\nbudget: window ${budget.window}, ceiling ${budget.ceilingTokens} tok / $${budget.ceilingUsd}\n` +
      `  round spend: ${verdict.roundTokens} tok / $${verdict.roundUsd.toFixed(4)}\n` +
      `  dispatch: ${verdict.ok ? "ALLOWED" : `YIELD (${verdict.reason})`}\n`,
  )
}

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" },
      "request-id": { type: "string" },
      phase: { type: "string" },
      role: { type: "string" },
      prompt: { type: "string" },
      worktree: { type: "string" },
      agent: { type: "string" },
      model: { type: "string" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: true,
  })
  const command = positionals[0]
  const store = new Store(DB_PATH)
  try {
    if (command === "status") {
      status(store)
      return
    }
    if (command === "seed") {
      if (values.file === undefined) throw new Error("seed needs --file <plan.json>")
      const plan = JSON.parse(readFileSync(values.file, "utf8")) as Plan
      const added = seedPlan(store, plan)
      process.stdout.write(`seeded ${added} new task(s) for round ${plan.round}\n`)
      return
    }
    if (command === "run") {
      const budget = readBudget(BUDGET_PATH)
      if (budget === undefined) throw new Error("no budget committed at tools/foreman/budget.json")
      const report = await runPending(store, {
        project: ".",
        budget,
        ...(values.model === undefined ? {} : { model: values.model }),
        ...(values["dry-run"] === true ? { dryRun: true } : {}),
      })
      process.stdout.write(
        `\nstopped: ${report.stoppedBecause}; dispatched ${report.dispatched.length}\n`,
      )
      return
    }
    if (command === "dispatch") {
      const budget = readBudget(BUDGET_PATH)
      if (budget === undefined) throw new Error("no budget committed at tools/foreman/budget.json")
      const verdict = decide(budget, accountUsage("."), 0)
      if (!verdict.ok) throw new Error(`budget says yield: ${verdict.reason}`)
      const run = await dispatchChild({
        prompt: values.prompt ?? "",
        title: values["request-id"] ?? "foreman/dispatch",
        model: values.model ?? MODEL_FREE,
        ...(values.agent === undefined ? {} : { agent: values.agent }),
        ...(values.worktree === undefined ? {} : { cwd: values.worktree }),
      })
      const ok = run.code === 0 && run.events > 0
      process.stdout.write(
        `session ${run.sessionID || "none"} · ${run.events} event(s) · exit ${run.code}\n${run.text.trim()}\n` +
          (ok ? "" : `\n(nothing came back; ${MODEL_GO} is the other line)\n`),
      )
      return
    }
    usage()
    process.exitCode = command === undefined ? 0 : 1
  } finally {
    store.close()
  }
}

await main()
