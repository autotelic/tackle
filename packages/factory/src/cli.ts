import { parseArgs } from "node:util"
import * as Schema from "effect/Schema"
import { adopt } from "./adopt.ts"
import { listWorkstreams, Phase } from "./store.ts"

const usage = [
  "factory — adopt in-flight work as durable workstreams",
  "",
  "Usage:",
  "  factory adopt --path <worktree> --project <linear> --label <label> --pr <n> [--phase reconcile|build|land] [--id <id>]",
  "  factory status [--json]",
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

  if (command !== "adopt") return fail("unknown command " + command + " (see --help)")
  const parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      path: { type: "string" },
      project: { type: "string" },
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
