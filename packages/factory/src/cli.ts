import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { adopt } from "./adopt.ts"
import { appendEvent } from "./events.ts"
import { runPass } from "./kernel.ts"
import { listWorkstreams, Phase, readWorkstream, writeWorkstream } from "./store.ts"
import { deliverReport, fingerprintOf, ReportKind, writeReport, type Report } from "./report.ts"
import { answerDesk, listDesk, raiseDesk, readAnswer, type DeskItem } from "./desk.ts"
import { runDaemon, startDaemon, stopDaemon } from "./daemon.ts"
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
  "  factory report --workstream <id> --kind <kind> --command <cmd> --expected <text> --actual <text> [--output <text>] [--blocked] [--deliver <session>]",
  "  factory phase --id <id> --set reconcile|build|land|blocked|done [--answer <desk-answer.json>]",
  "  factory daemon start --worker <command> [--interval <ms>]",
  "  factory daemon run --worker <command> [--interval <ms>]",
  "  factory daemon stop",
  "  factory cursor --id <id> --github <iso> --linear <iso>",
  "  factory desk list [--json]",
  "  factory desk answer --item <id> --choice <choice> --by <did-or-name>",
  "  factory desk raise --workstream <id> --title <text> [--body <text>] [--choices <a,b>] [--route live|github|slack]",
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
    for (const item of await listDesk())
      console.log("desk " + item.id + "  " + item.workstream + "  " + item.title)
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

  if (command === "desk") {
    const sub = process.argv[3]
    if (sub === "list") {
      const parsed = parseArgs({
        args: process.argv.slice(4),
        options: { json: { type: "boolean", default: false } },
        allowPositionals: false,
      })
      const items = await listDesk()
      if (parsed.values.json) console.log(JSON.stringify(items, null, 2))
      else
        for (const item of items) console.log(item.id + "  " + item.workstream + "  " + item.title)
      return
    }
    if (sub === "answer") {
      const parsed = parseArgs({
        args: process.argv.slice(4),
        options: {
          item: { type: "string" },
          choice: { type: "string" },
          by: { type: "string", default: process.env.USER ?? "human" },
        },
        allowPositionals: false,
      })
      if (parsed.values.item === undefined || parsed.values.choice === undefined)
        return fail("desk answer needs --item and --choice")
      await answerDesk({
        answer: {
          item: parsed.values.item,
          choice: parsed.values.choice,
          by: parsed.values.by,
          at: new Date().toISOString(),
        },
      })
      console.log("factory: answered " + parsed.values.item + " = " + parsed.values.choice)
      return
    }
    if (sub === "raise") {
      const parsed = parseArgs({
        args: process.argv.slice(4),
        options: {
          workstream: { type: "string" },
          title: { type: "string" },
          body: { type: "string", default: "" },
          choices: { type: "string", default: "accept,decline" },
          route: { type: "string", default: "live" },
          id: { type: "string" },
        },
        allowPositionals: false,
      })
      if (parsed.values.workstream === undefined || parsed.values.title === undefined)
        return fail("desk raise needs --workstream and --title")
      if (
        parsed.values.route !== "live" &&
        parsed.values.route !== "github" &&
        parsed.values.route !== "slack"
      )
        return fail("--route must be live, github or slack")
      const item: DeskItem = {
        id: parsed.values.id ?? "desk-" + parsed.values.workstream + "-" + Date.now(),
        workstream: parsed.values.workstream,
        kind: "decision",
        title: parsed.values.title,
        body: parsed.values.body,
        choices: parsed.values.choices
          .split(",")
          .map((choice) => choice.trim())
          .filter(Boolean),
        route: parsed.values.route,
        at: new Date().toISOString(),
      }
      await raiseDesk({ item })
      console.log("factory: desk " + item.id + " raised")
      return
    }
    return fail("desk needs list, answer or raise")
  }

  if (command === "cursor") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        id: { type: "string" },
        github: { type: "string" },
        linear: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("cursor needs --id")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    await writeWorkstream({
      record: {
        ...record,
        cursors: {
          github: parsed.values.github ?? record.cursors.github,
          linear: parsed.values.linear ?? record.cursors.linear,
        },
        updatedAt: new Date().toISOString(),
      },
    })
    console.log("factory: " + record.id + " cursors set")
    return
  }

  if (command === "daemon") {
    const sub = process.argv[3]
    if (sub === "stop") {
      console.log("factory: daemon " + (await stopDaemon()))
      return
    }
    if (sub !== "start" && sub !== "run") return fail("daemon needs start, run or stop")
    const parsed = parseArgs({
      args: process.argv.slice(4),
      options: {
        worker: { type: "string" },
        interval: { type: "string", default: "60000" },
      },
      allowPositionals: false,
    })
    if (parsed.values.worker === undefined) return fail("daemon needs --worker")
    const interval = Number(parsed.values.interval)
    if (!Number.isInteger(interval) || interval < 1)
      return fail("--interval must be a positive integer")
    if (sub === "start") {
      const pid = await startDaemon({ worker: parsed.values.worker, intervalMs: interval })
      console.log("factory: daemon " + pid + " running")
      return
    }
    await runDaemon({ worker: parsed.values.worker, intervalMs: interval })
    return
  }

  if (command === "phase") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        id: { type: "string" },
        set: { type: "string" },
        answer: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.set === undefined)
      return fail("phase needs --id and --set")
    if (!Schema.is(Phase)(parsed.values.set))
      return fail("--set must be one of reconcile, build, land, blocked, done")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")

    // A phase change is a gate, not a convenience. Leaving reconcile or blocked needs an
    // answer record; otherwise anyone can advance a held workstream (a probe did exactly that).
    if (record.phase === "reconcile" || record.phase === "blocked") {
      if (parsed.values.answer === undefined)
        return fail(
          "desk gate: " +
            record.phase +
            " -> " +
            parsed.values.set +
            " needs --answer <desk-answer.json>",
        )
      const text = await readFile(parsed.values.answer, "utf8").catch(() => undefined)
      let choice: string
      if (text === undefined) {
        const stored = await readAnswer({ id: parsed.values.answer })
        if (stored === undefined) return fail("desk answer not found: " + parsed.values.answer)
        choice = stored.choice
      } else {
        const answer = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
        if (Result.isFailure(answer)) return fail("desk answer is not JSON")
        const decoded = Schema.decodeUnknownResult(Schema.Struct({ choice: Schema.String }))(
          answer.success,
        )
        if (Result.isFailure(decoded)) return fail("desk answer has no choice")
        choice = decoded.success.choice
      }
      if (choice !== "accept" && choice !== "accept-and-continue" && choice !== "apply-evidenced")
        return fail("desk answer must choose accept, accept-and-continue or apply-evidenced")
    }

    await writeWorkstream({
      record: { ...record, phase: parsed.values.set, updatedAt: new Date().toISOString() },
    })
    console.log("factory: " + record.id + " phase " + parsed.values.set)
    return
  }

  if (command === "report") {
    const parsed = parseArgs({
      args: process.argv.slice(3),
      options: {
        workstream: { type: "string" },
        kind: { type: "string" },
        command: { type: "string" },
        expected: { type: "string" },
        actual: { type: "string" },
        output: { type: "string", default: "" },
        blocked: { type: "boolean", default: false },
        id: { type: "string" },
        deliver: { type: "string" },
      },
      allowPositionals: false,
    })
    const { workstream, kind, command: invoked, expected, actual } = parsed.values
    if (
      workstream === undefined ||
      kind === undefined ||
      invoked === undefined ||
      expected === undefined ||
      actual === undefined
    )
      return fail("report needs --workstream, --kind, --command, --expected and --actual")
    if (!Schema.is(ReportKind)(kind))
      return fail("--kind must be ergonomics, conformance, docs, blocker or quality")
    const at = new Date().toISOString()
    const id = parsed.values.id ?? "report-" + workstream + "-" + Date.parse(at)
    const report: Report = {
      id,
      workstream,
      kind,
      at,
      command: invoked,
      expected,
      actual,
      output: parsed.values.output,
      blocked: parsed.values.blocked,
      fingerprint: fingerprintOf({ kind, command: invoked, actual }),
    }
    await writeReport({ report })
    console.log("factory: report " + id + " written")
    if (parsed.values.deliver !== undefined) {
      const delivered = deliverReport({ report, to: parsed.values.deliver })
      if (Result.isFailure(delivered))
        return fail("report written, but intercom delivery failed: " + delivered.failure)
    }
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
