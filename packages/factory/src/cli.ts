import { parseArgs } from "node:util"
import * as Schema from "effect/Schema"
import { adopt } from "./adopt.ts"
import { appendEvent } from "./events.ts"
import { runPass } from "./kernel.ts"
import { listWorkstreams, Phase } from "./store.ts"
import { watchOnce } from "./watch.ts"

const usage = [
  "factory — adopt in-flight work as durable workstreams",
  "",
  "Usage:",
  "  factory adopt --path <worktree> --project <linear> --label <label> --pr <n> [--phase reconcile|build|land] [--id <id>]",
  "  factory status [--json]",
  "  factory event --id <id> --kind <kind> [--payload <json>] [--at <iso>]",
  "  factory run --id <id> --worker <command> [--at <iso>]",
  "  factory watch --id <id> --worker <command> [--once] [--interval <ms>]",
  "",
  "FACTORY_HOME defaults to ~/.factory; records live outside the governed repository.",
].join("\n")

const fail = (message: string): never => {
  console.error("factory: " + message)
  process.exit(1)
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "workstream"

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }

  if (command === "status") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: { json: { type: "boolean", default: false } },
      allowPositionals: false,
    })
    const records = await listWorkstreams()
    if (parsed.values.json) {
      console.log(JSON.stringify(records, null, 2))
      return
    }
    for (const record of records)
      console.log(
        [
          record.id,
          record.project,
          "PR " + record.pr,
          record.phase,
          record.path,
          "checkpoint " + record.checkpoint.sha.slice(0, 8),
        ].join("  "),
      )
    return
  }

  if (command === "event") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        id: { type: "string" },
        kind: { type: "string" },
        payload: { type: "string", default: "{}" },
        at: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.kind === undefined)
      return fail("event needs --id and --kind")
    const at = parsed.values.at ?? new Date().toISOString()
    const id = parsed.values.kind + "-" + Date.parse(at)
    await appendEvent({
      id: parsed.values.id,
      event: {
        id,
        kind: parsed.values.kind,
        at,
        payload: JSON.parse(parsed.values.payload),
        status: "pending",
      },
    })
    console.log("factory: event " + id + " queued for " + parsed.values.id)
    return
  }

  if (command === "run") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        id: { type: "string" },
        worker: { type: "string" },
        at: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.worker === undefined)
      return fail("run needs --id and --worker")
    const at = parsed.values.at ?? new Date().toISOString()
    const result = await runPass({
      id: parsed.values.id,
      worker: parsed.values.worker,
      at,
    })
    if (!result.ok) return fail(result.reason)
    console.log(
      "factory: " +
        result.receipt.workstream +
        " pass " +
        result.receipt.pass +
        " done; checkpoint " +
        result.checkpoint.slice(0, 8),
    )
    return
  }

  if (command === "watch") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        id: { type: "string" },
        worker: { type: "string" },
        once: { type: "boolean", default: false },
        interval: { type: "string", default: "60000" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.worker === undefined)
      return fail("watch needs --id and --worker")
    const interval = Number(parsed.values.interval)
    if (!Number.isInteger(interval) || interval < 1)
      return fail("--interval must be a positive integer")
    for (;;) {
      const outcome = await watchOnce({
        id: parsed.values.id,
        worker: parsed.values.worker,
        at: new Date().toISOString(),
      })
      console.log(
        "factory: watch " +
          parsed.values.id +
          " appended " +
          outcome.appended.length +
          ", passes " +
          outcome.passes.filter((pass) => pass.ok).length +
          "/" +
          outcome.passes.length,
      )
      if (parsed.values.once) return
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }

  if (command !== "adopt") return fail("unknown command " + command + " (see --help)")
  const parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      path: { type: "string" },
      project: { type: "string" },
      "linear-project-id": { type: "string" },
      label: { type: "string" },
      pr: { type: "string" },
      id: { type: "string" },
      phase: { type: "string", default: "reconcile" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  })
  if (parsed.values.help === true) {
    console.log(usage)
    return
  }
  const { path, project, label, pr } = parsed.values
  if (path === undefined || project === undefined || label === undefined || pr === undefined)
    return fail("adopt needs --path, --project, --label and --pr")
  const number = Number(pr)
  if (!Number.isInteger(number) || number < 1) return fail("--pr must be a positive integer")
  const phase = parsed.values.phase
  if (!Schema.is(Phase)(phase))
    return fail("--phase must be one of reconcile, build, land, blocked, done")
  const id = parsed.values.id ?? slug(label + "-" + number)

  const result = await adopt({
    path,
    project,
    linearProjectId: parsed.values["linear-project-id"],
    label,
    pr: number,
    id,
    phase,
    at: new Date().toISOString(),
  })
  if (!result.ok) return fail(result.error.step + ": " + result.error.detail)
  const record = result.value
  console.log(
    [
      "factory: adopted " + record.id,
      "  project    " + record.project,
      "  path       " + record.path,
      "  branch     " + record.branch + " @ " + record.head.slice(0, 8),
      "  PR         " + record.pr + " -> " + record.base,
      "  phase      " + record.phase,
      "  checkpoint " + record.checkpoint.sha.slice(0, 8) + " (" + record.checkpoint.ref + ")",
      "  record     " + record.id + ".json",
    ].join("\n"),
  )
}

main().catch((cause) => fail(String(cause)))
