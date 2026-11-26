import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { adopt } from "./adopt.ts"
import {
  checkRepositoryCredentials,
  CredentialKind,
  leaseFor,
  listCredentials,
  prepareWorkstreamCredentials,
  removeCredential,
  setCredential,
  setGrants,
  grantsFor,
  writeLease,
} from "./executor.ts"
import { branchGuard } from "./branch.ts"
import { appendEvent, consumeEvents } from "./events.ts"
import { runPass } from "./kernel.ts"
import { Gates, listWorkstreams, Phase, readWorkstream, writeWorkstream } from "./store.ts"
import { deliverReport, fingerprintOf, ReportKind, writeReport, type Report } from "./report.ts"
import { answerDesk, listDesk, raiseDesk, readAnswer, withdrawDesk, type DeskItem } from "./desk.ts"
import {
  CandidateEnvironmentRefused,
  createCandidateEnvironment,
  listCandidateEnvironments,
  registerCandidateEnvironment,
  setCandidateEnvironmentState,
} from "./candidate-environments.ts"
import { runDaemon, startDaemon, stopDaemon } from "./daemon.ts"
import { runReady } from "./ready.ts"
import { readTelemetry } from "./telemetry.ts"
import { watchOnce } from "./watch.ts"

const usage = [
  "factory — adopt in-flight work as durable workstreams",
  "",
  "Usage:",
  "  factory adopt --path <worktree> --project <linear> --label <label> [--pr <n> | --delivery trunk] [--reports <dir>] [--repo <owner/name>] [--phase reconcile|build|compress|land] [--id <id>]",
  "  factory status [--json]",
  "  factory credentials list [--json]",
  "  factory credentials set --id <id> --kind github|opencode|mcp|service|generic --env NAME[=HOST] [--env ...] [--description <text>]",
  "  factory credentials remove --id <id>",
  "  factory credentials check --path <repo> [--json]",
  "  factory grant set --workstream <id> --credential <id> [--credential ...]",
  "  factory grant list --workstream <id> [--json]",
  "  factory grant revoke --workstream <id> --credential <id>",
  "  factory executor prepare --id <id>",
  "  factory executor lease --id <id> [--ttl <seconds>] [--out <file>]",
  "  factory telemetry [--since <iso>] [--json] [--check]",
  "  factory event --id <id> --kind <kind> [--payload <json>] [--at <iso>]",
  "  factory event retire --id <id> --event <event-id>",
  "  factory event resolve --id <id> --event <event-id> --reason <text>",
  "  factory adopt-commits --id <id> --from <ref> --commits <sha,sha> [--policy keep-parent|prefer-source] --expected-head <sha>",
  "  factory run --id <id> --worker <command> [--at <iso>]",
  "  factory watch --id <id> --worker <command> [--once] [--interval <ms>]",
  "  factory report --workstream <id> --kind <kind> --command <cmd> --expected <text> --actual <text> [--output <text>] [--blocked] [--deliver <session>]",
  "  factory phase --id <id> --set reconcile|build|compress|land|blocked|done [--answer <desk-answer.json>]",
  "  factory ready --id <id> [--at <iso>] [--timeout <ms>]",
  "  factory compress --id <id> [--task <text>] [--answer <desk-answer.json>]",
  "  factory gates --id <id> --file <gates.json>",
  "  factory conventions --id <id> [--path AGENTS.md]",
  "  factory retire --id <id> [--close-pr]",
  "  factory daemon start --worker <command> [--interval <ms>]",
  "  factory daemon run --worker <command> [--interval <ms>]",
  "  factory daemon stop",
  "  factory link --id <id> --linear-url <https://linear.app/...>",
  "  factory guard [--path <dir>]",
  "  factory worker --id <id> --worker <command|intercom:session>",
  "  factory cursor --id <id> --github <iso> --linear <iso>",
  "  factory budget --id <id> --passes-per-phase <n>",
  "  factory desk list [--json]",
  "  factory desk answer --item <id> --choice <choice> --by <did-or-name>",
  "  factory desk raise --workstream <id> --title <text> [--body <text>] [--choices <a,b>] [--route live|github|slack]",
  "  factory desk withdraw --item <id> --by <did-or-name> --reason <text>",
  "  factory candidate new --workstream <id> [--label <text>] [--root .room]",
  "  factory candidate register --workstream <id> --label <text> --path <dir> --branch <branch> [--head <sha>] [--room <id>]",
  "  factory candidate list [--workstream <id>] [--json]",
  "  factory candidate promote --id <id>",
  "  factory candidate drop --id <id>",
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

const main = async (argv: ReadonlyArray<string>): Promise<void> => {
  const command = argv[0]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }

  if (command === "telemetry") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        since: { type: "string" },
        json: { type: "boolean", default: false },
        check: { type: "boolean", default: false },
      },
      allowPositionals: false,
    })
    const since = parsed.values.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    if (Number.isNaN(Date.parse(since))) return fail("--since must be an ISO instant")
    const sessions = await readTelemetry({ since })
    const browserCalls = sessions.filter((session) => session.linearBrowserCalls > 0)
    if (parsed.values.check && browserCalls.length > 0) {
      for (const session of browserCalls)
        console.error(
          "factory: " +
            session.workstream +
            " opened Linear in browse " +
            String(session.linearBrowserCalls) +
            " time(s) at " +
            session.startedAt,
        )
      process.exitCode = 1
    }
    if (parsed.values.json) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }
    for (const session of sessions)
      console.log(
        [
          session.workstream.padEnd(26),
          session.startedAt.slice(11, 19),
          String(session.wallSeconds).padStart(5) + "s wall",
          String(session.modelSeconds).padStart(5) + "s model",
          String(session.toolSeconds).padStart(5) + "s tool",
          String(session.toolCalls).padStart(3) + " calls",
          String(session.measurementCalls).padStart(3) + " measure",
          String(session.editCalls).padStart(3) + " edit",
          String(session.commits).padStart(3) + " commit",
          String(session.linearBrowserCalls).padStart(3) + " linear-web",
          "$" + session.costUsd.toFixed(3),
        ].join("  "),
      )
    return
  }

  if (command === "status") {
    const parsed = parseArgs({
      args: argv.slice(1),
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
          record.delivery === "trunk" || record.pr === undefined
            ? "delivery trunk"
            : "PR " + record.pr,
          record.phase,
          record.path,
          "checkpoint " + record.checkpoint.sha.slice(0, 8),
        ].join("  "),
      )
    for (const item of await listDesk())
      console.log("desk " + item.id + "  " + item.workstream + "  " + item.title)
    return
  }

  if (command === "candidate") {
    const verb = argv[1]
    // One refusal path for every verb: the store names what it would not write, and the CLI
    // prints that rather than a stack trace a human would have to decode.
    const refused = (cause: unknown): never =>
      fail(cause instanceof CandidateEnvironmentRefused ? cause.detail : String(cause))
    if (verb === "list") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: { workstream: { type: "string" }, json: { type: "boolean", default: false } },
        allowPositionals: false,
      })
      const records = await listCandidateEnvironments({ workstream: parsed.values.workstream })
      if (parsed.values.json) {
        console.log(JSON.stringify(records, null, 2))
        return
      }
      for (const record of records)
        console.log(
          [
            record.workstream,
            record.id,
            record.state,
            record.branch,
            record.head.slice(0, 8),
            record.path,
          ].join("  "),
        )
      return
    }
    if (verb === "new") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: {
          workstream: { type: "string" },
          label: { type: "string", default: "candidate" },
          root: { type: "string", default: ".room" },
          vm: { type: "boolean", default: true },
          "no-vm": { type: "boolean", default: false },
        },
        allowPositionals: false,
      })
      if (parsed.values.workstream === undefined)
        return fail("candidate new needs --workstream (see factory --help)")
      const record = await createCandidateEnvironment({
        workstream: parsed.values.workstream,
        label: parsed.values.label,
        roomRoot: parsed.values.root,
        vm: parsed.values.vm && !parsed.values["no-vm"],
      }).catch(refused)
      console.log("factory: candidate " + record.id + " " + record.state + " at " + record.path)
      return
    }
    if (verb === "register") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: {
          workstream: { type: "string" },
          label: { type: "string" },
          path: { type: "string" },
          branch: { type: "string" },
          head: { type: "string" },
          room: { type: "string" },
        },
        allowPositionals: false,
      })
      const values = parsed.values
      if (
        values.workstream === undefined ||
        values.label === undefined ||
        values.path === undefined ||
        values.branch === undefined
      )
        return fail("candidate register needs --workstream, --label, --path and --branch")
      const record = await registerCandidateEnvironment({
        workstream: values.workstream,
        label: values.label,
        path: values.path,
        branch: values.branch,
        head: values.head ?? (await readWorkstream({ id: values.workstream }))?.head ?? "",
        room: values.room,
      }).catch(refused)
      console.log("factory: candidate " + record.id + " registered at " + record.path)
      return
    }
    if (verb === "promote" || verb === "drop") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: { id: { type: "string" } },
        allowPositionals: false,
      })
      if (parsed.values.id === undefined) return fail("candidate " + verb + " needs --id")
      const record = await setCandidateEnvironmentState({
        id: parsed.values.id,
        state: verb === "promote" ? "promoted" : "dropped",
      }).catch(refused)
      console.log("factory: candidate " + record.id + " " + record.state)
      return
    }
    return fail("candidate needs one of new, register, list, promote, drop")
  }

  if (command === "event" && (argv[1] === "retire" || argv[1] === "resolve")) {
    const parsed = parseArgs({
      args: argv.slice(2),
      options: {
        id: { type: "string" },
        event: { type: "string" },
        reason: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.event === undefined)
      return fail("event " + argv[1] + " needs --id and --event")
    await consumeEvents({ id: parsed.values.id, ids: [parsed.values.event] })
    console.log(
      "factory: event " +
        parsed.values.event +
        " " +
        (argv[1] === "resolve" ? "resolved" : "retired") +
        " for " +
        parsed.values.id +
        (parsed.values.reason === undefined ? "" : " — " + parsed.values.reason),
    )
    return
  }

  if (command === "event") {
    const parsed = parseArgs({
      args: argv.slice(1),
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

  if (command === "adopt-commits") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        id: { type: "string" },
        from: { type: "string" },
        commits: { type: "string" },
        policy: { type: "string", default: "keep-parent" },
        "expected-head": { type: "string" },
      },
      allowPositionals: false,
    })
    const id = parsed.values.id
    const source = parsed.values.from
    const commits = parsed.values.commits
      ?.split(",")
      .map((commit) => commit.trim())
      .filter(Boolean)
    const policy = parsed.values.policy
    const expectedHead = parsed.values["expected-head"]
    if (id === undefined || source === undefined || commits === undefined || commits.length === 0)
      return fail("adopt-commits needs --id, --from and --commits")
    if (expectedHead === undefined) return fail("adopt-commits needs --expected-head")
    if (policy !== "keep-parent" && policy !== "prefer-source")
      return fail("--policy must be keep-parent or prefer-source")
    const at = new Date().toISOString()
    const eventId = "adopt-commits-" + Date.parse(at)
    await appendEvent({
      id,
      event: {
        id: eventId,
        kind: "adopt-commits",
        at,
        payload: { source, commits, policy, expectedHead },
        status: "pending",
      },
    })
    console.log("factory: adopt-commits " + eventId + " queued for " + id)
    return
  }

  if (command === "run") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        id: { type: "string" },
        worker: { type: "string" },
        at: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("run needs --id")
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
    const sub = argv[1]
    if (sub === "list") {
      const parsed = parseArgs({
        args: argv.slice(2),
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
        args: argv.slice(2),
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
    if (sub === "withdraw") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: {
          item: { type: "string" },
          by: { type: "string", default: process.env.USER ?? "factory" },
          reason: { type: "string" },
        },
        allowPositionals: false,
      })
      if (parsed.values.item === undefined || parsed.values.reason === undefined)
        return fail("desk withdraw needs --item and --reason")
      await withdrawDesk({
        withdrawal: {
          item: parsed.values.item,
          by: parsed.values.by,
          reason: parsed.values.reason,
          at: new Date().toISOString(),
        },
      })
      console.log("factory: withdrew " + parsed.values.item)
      return
    }
    if (sub === "raise") {
      const parsed = parseArgs({
        args: argv.slice(2),
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

  if (command === "guard") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { path: { type: "string" } },
      allowPositionals: false,
    })
    const path = parsed.values.path ?? process.cwd()
    const verdict = await branchGuard({ path })
    if (verdict._tag === "Mismatch") return fail(verdict.reason)
    console.log(
      "factory: guard " +
        (verdict._tag === "Ungoverned"
          ? "no record owns " + path
          : verdict.record.id + " is on its branch " + verdict.branch),
    )
    return
  }

  if (command === "worker") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, worker: { type: "string" } },
      allowPositionals: false,
    })
    const { id, worker } = parsed.values
    if (id === undefined || worker === undefined) return fail("worker needs --id and --worker")
    const record = await readWorkstream({ id })
    if (record === undefined) return fail("WorkstreamNotFound")
    await writeWorkstream({
      record: { ...record, worker, updatedAt: new Date().toISOString() },
    })
    console.log("factory: " + record.id + " worker set")
    return
  }

  if (command === "link") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, "linear-url": { type: "string" } },
      allowPositionals: false,
    })
    const { id } = parsed.values
    const url = parsed.values["linear-url"]
    if (id === undefined || url === undefined) return fail("link needs --id and --linear-url")
    if (!url.startsWith("https://linear.app/"))
      return fail("--linear-url must start with https://linear.app/")
    const record = await readWorkstream({ id })
    if (record === undefined) return fail("WorkstreamNotFound")
    await writeWorkstream({
      record: { ...record, linearUrl: url, updatedAt: new Date().toISOString() },
    })
    console.log("factory: " + record.id + " linear link set")
    return
  }

  if (command === "cursor") {
    const parsed = parseArgs({
      args: argv.slice(1),
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
    const sub = argv[1]
    if (sub === "stop") {
      console.log("factory: daemon " + (await stopDaemon()))
      return
    }
    if (sub !== "start" && sub !== "run") return fail("daemon needs start, run or stop")
    const parsed = parseArgs({
      args: argv.slice(2),
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

  if (command === "retire") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, "close-pr": { type: "boolean", default: false } },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("retire needs --id")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    if (parsed.values["close-pr"]) {
      if (record.pr === undefined) return fail("--close-pr needs a PR workstream")
      const closed = spawnSync(
        process.env.GH_BIN ?? "gh",
        ["pr", "close", String(record.pr), "--repo", record.repo],
        { encoding: "utf8" },
      )
      if (closed.status !== 0)
        return fail("gh pr close failed: " + (closed.stderr || closed.stdout).trim())
    }
    await writeWorkstream({
      record: { ...record, phase: "done", updatedAt: new Date().toISOString() },
    })
    console.log(
      "factory: " +
        record.id +
        " retired" +
        (record.pr === undefined ? "" : " (PR #" + record.pr + ")"),
    )
    return
  }

  if (command === "conventions") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, path: { type: "string", default: "AGENTS.md" } },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("conventions needs --id")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    const path = parsed.values.path
    const text = await readFile(join(record.path, path), "utf8").catch(() => undefined)
    if (text === undefined) return fail("conventions file not found: " + path)
    const at = new Date().toISOString()
    const sha = createHash("sha256").update(text).digest("hex")
    await writeWorkstream({
      record: { ...record, conventions: { path, sha, at }, updatedAt: at },
      control: true,
    })
    console.log("factory: " + record.id + " conventions " + path + " @ " + sha.slice(0, 12))
    return
  }

  if (command === "gates") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, file: { type: "string" } },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined || parsed.values.file === undefined)
      return fail("gates needs --id and --file")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    const text = await readFile(parsed.values.file, "utf8").catch(() => undefined)
    if (text === undefined) return fail("gates file not found: " + parsed.values.file)
    const decoded = Schema.decodeResult(Schema.fromJsonString(Gates))(text)
    if (Result.isFailure(decoded)) return fail("gates file does not decode")
    await writeWorkstream({
      record: { ...record, gates: decoded.success, updatedAt: new Date().toISOString() },
      control: true,
    })
    console.log("factory: " + record.id + " gates installed")
    return
  }

  if (command === "compress") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        id: { type: "string" },
        task: { type: "string" },
        answer: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("compress needs --id")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    if (record.phase === "blocked" || record.phase === "reconcile") {
      if (parsed.values.answer === undefined)
        return fail(
          "compress cannot leave " + record.phase + " without --answer <desk-answer.json>",
        )
      const text = await readFile(parsed.values.answer, "utf8").catch(() => undefined)
      if (text === undefined) return fail("desk answer not found: " + parsed.values.answer)
      const decoded = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
      if (Result.isFailure(decoded)) return fail("desk answer is not JSON")
      const answer = Schema.decodeUnknownResult(Schema.Struct({ choice: Schema.String }))(
        decoded.success,
      )
      if (Result.isFailure(answer)) return fail("desk answer has no choice")
      if (
        answer.success.choice !== "accept" &&
        answer.success.choice !== "accept-and-continue" &&
        answer.success.choice !== "apply-evidenced"
      )
        return fail("desk answer must choose accept, accept-and-continue or apply-evidenced")
    }
    if (record.phase === "land" || record.phase === "done")
      return fail("workstream is already " + record.phase)
    const at = new Date().toISOString()
    await writeWorkstream({
      record: { ...record, phase: "compress", updatedAt: at },
      control: true,
    })
    await appendEvent({
      id: record.id,
      event: {
        id: "compress-" + Date.parse(at),
        kind: "task",
        at,
        payload: {
          task:
            parsed.values.task ??
            "Run one compression cut: inventory the branch changes, remove scaffolding, keep load-bearing files, and compress one duplication or domain/composition seam. One commit, push, stop. Static lenses only; no tests or CI.",
        },
        status: "pending",
      },
    })
    console.log("factory: " + record.id + " compression event queued; phase compress")
    return
  }

  if (command === "ready") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        id: { type: "string" },
        at: { type: "string" },
        timeout: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("ready needs --id")
    const at = parsed.values.at ?? new Date().toISOString()
    if (Number.isNaN(Date.parse(at))) return fail("--at must be an ISO instant")
    const timeoutMs =
      parsed.values.timeout === undefined ? undefined : Number(parsed.values.timeout)
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1))
      return fail("--timeout must be a positive integer of milliseconds")
    const result = await runReady({ id: parsed.values.id, at, timeoutMs })
    for (const check of result.checks)
      console.log(
        check.name + "  exit " + check.exit + "  " + Math.round(check.durationMs / 1000) + "s",
      )
    if (!result.ok) {
      console.error(
        "factory: ready failed" + (result.reason === undefined ? "" : ": " + result.reason),
      )
      process.exitCode = 1
    }
    return
  }

  if (command === "phase") {
    const parsed = parseArgs({
      args: argv.slice(1),
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
      return fail("--set must be one of reconcile, build, compress, land, blocked, done")
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
      control: true,
    })
    console.log("factory: " + record.id + " phase " + parsed.values.set)
    return
  }

  if (command === "budget") {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: { id: { type: "string" }, "passes-per-phase": { type: "string" } },
      allowPositionals: false,
    })
    const { id } = parsed.values
    const passes = Number(parsed.values["passes-per-phase"])
    if (id === undefined || parsed.values["passes-per-phase"] === undefined)
      return fail("budget needs --id and --passes-per-phase")
    if (!Number.isInteger(passes) || passes < 1)
      return fail("--passes-per-phase must be a positive integer")
    const record = await readWorkstream({ id })
    if (record === undefined) return fail("unknown workstream " + id)
    await writeWorkstream({
      record: {
        ...record,
        budgets: { ...record.budgets, passesPerPhase: passes },
        updatedAt: new Date().toISOString(),
      },
      control: true,
    })
    console.log("factory: " + id + " passes per phase -> " + passes)
    return
  }

  if (command === "report") {
    const parsed = parseArgs({
      args: argv.slice(1),
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
      args: argv.slice(1),
      options: {
        id: { type: "string" },
        worker: { type: "string" },
        once: { type: "boolean", default: false },
        interval: { type: "string", default: "60000" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("watch needs --id")
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

  if (command === "credentials") {
    const sub = argv[1]
    if (sub === "list") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: { json: { type: "boolean", default: false } },
        allowPositionals: false,
      })
      const credentials = await listCredentials()
      if (parsed.values.json) console.log(JSON.stringify(credentials, null, 2))
      else if (credentials.length === 0) console.log("no credentials configured")
      else
        for (const credential of credentials)
          console.log(
            credential.id.padEnd(18) +
              credential.kind.padEnd(10) +
              credential.env.join(",") +
              (credential.description === undefined ? "" : "  " + credential.description),
          )
      return
    }
    if (sub === "set") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: {
          id: { type: "string" },
          kind: { type: "string" },
          env: { type: "string", multiple: true },
          description: { type: "string" },
        },
        allowPositionals: false,
      })
      const { id, kind } = parsed.values
      if (id === undefined || kind === undefined)
        return fail("credentials set needs --id and --kind")
      if (!Schema.is(CredentialKind)(kind))
        return fail("--kind must be github, opencode, mcp, service, observability or generic")
      const specs = parsed.values.env ?? []
      if (specs.length === 0)
        return fail("credentials set needs at least one --env NAME or --env NAME=HOST_VAR")
      const env: Record<string, string> = {}
      for (const spec of specs) {
        const [target, source] = spec.includes("=") ? spec.split("=", 2) : [spec, spec]
        if (target === undefined || target === "" || source === undefined || source === "")
          return fail("--env needs NAME or NAME=HOST_VAR")
        const value = process.env[source]
        if (value === undefined || value === "")
          return fail("host environment has no " + source + " for --env " + spec)
        env[target] = value
      }
      const summary = await setCredential({
        id,
        kind,
        description: parsed.values.description,
        env,
        at: new Date().toISOString(),
      })
      console.log(
        "credential " +
          summary.id +
          " (" +
          summary.kind +
          ") stores " +
          summary.env.join(", ") +
          "; secret values were not printed",
      )
      return
    }
    if (sub === "remove") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: { id: { type: "string" } },
        allowPositionals: false,
      })
      if (parsed.values.id === undefined) return fail("credentials remove needs --id")
      const removed = await removeCredential({ id: parsed.values.id })
      if (!removed) return fail("no credential " + parsed.values.id)
      console.log("credential " + parsed.values.id + " removed")
      return
    }
    if (sub === "check") {
      const parsed = parseArgs({
        args: argv.slice(2),
        options: { path: { type: "string" }, json: { type: "boolean", default: false } },
        allowPositionals: false,
      })
      if (parsed.values.path === undefined) return fail("credentials check needs --path")
      const checks = await checkRepositoryCredentials({ repo: parsed.values.path })
      if (parsed.values.json) console.log(JSON.stringify(checks, null, 2))
      else if (checks.length === 0) console.log("no repository credential manifest")
      else
        for (const check of checks)
          console.log(
            check.id.padEnd(18) +
              check.kind.padEnd(10) +
              check.env.join(",").padEnd(24) +
              (check.present ? "ready" : "MISSING " + check.missingEnv.join(",")) +
              "  " +
              check.reason,
          )
      if (checks.some((check) => check.required && !check.present)) process.exitCode = 1
      return
    }
    return fail("credentials needs list, set, remove or check")
  }

  if (command === "grant") {
    const sub = argv[1]
    const parsed = parseArgs({
      args: argv.slice(2),
      options: {
        workstream: { type: "string" },
        credential: { type: "string", multiple: true },
        json: { type: "boolean", default: false },
      },
      allowPositionals: false,
    })
    const workstream = parsed.values.workstream
    if (workstream === undefined) return fail("grant needs --workstream")
    if (sub === "list") {
      const ids = await grantsFor({ workstream })
      if (parsed.values.json) console.log(JSON.stringify(ids, null, 2))
      else if (ids.length === 0) console.log("no credentials granted to " + workstream)
      else console.log(ids.join("\n"))
      return
    }
    if (sub === "set") {
      const ids = parsed.values.credential ?? []
      if (ids.length === 0) return fail("grant set needs --credential")
      const granted = await setGrants({ workstream, credentials: ids })
      console.log("granted " + granted.join(", ") + " to " + workstream)
      return
    }
    if (sub === "revoke") {
      const ids = parsed.values.credential ?? []
      if (ids.length === 0) return fail("grant revoke needs --credential")
      const current = await grantsFor({ workstream })
      const next = current.filter((id) => !ids.includes(id))
      await setGrants({ workstream, credentials: next })
      console.log(
        "granted to " + workstream + ": " + (next.length === 0 ? "none" : next.join(", ")),
      )
      return
    }
    return fail("grant needs set, list or revoke")
  }

  if (command === "executor") {
    const sub = argv[1]
    const parsed = parseArgs({
      args: argv.slice(2),
      options: {
        id: { type: "string" },
        ttl: { type: "string", default: "900" },
        out: { type: "string" },
      },
      allowPositionals: false,
    })
    if (parsed.values.id === undefined) return fail("executor needs --id")
    const record = await readWorkstream({ id: parsed.values.id })
    if (record === undefined) return fail("WorkstreamNotFound")
    if (sub === "prepare") {
      const prepared = await prepareWorkstreamCredentials({
        repo: record.path,
        workstream: record.id,
      })
      if (prepared.mode === null)
        console.log("no repository credential manifest; " + record.id + " keeps the host env")
      else if (!prepared.managed)
        console.log(
          "advisory " +
            record.id +
            "; " +
            prepared.checks.filter((check) => check.present).length +
            "/" +
            prepared.checks.length +
            " account(s) ready; host env unchanged until mode is enforce",
        )
      else
        console.log(
          "enforced " +
            record.id +
            "; " +
            prepared.checks.filter((check) => check.present).length +
            " credential(s) granted; host env is filtered",
        )
      return
    }
    if (sub === "lease") {
      const seconds = Number(parsed.values.ttl)
      if (!Number.isInteger(seconds) || seconds < 1) return fail("--ttl must be a positive integer")
      const lease = await leaseFor({
        workstream: record.id,
        ttlMs: seconds * 1000,
        at: Date.now(),
      })
      const path = await writeLease({ lease, out: parsed.values.out })
      console.log(path)
      return
    }
    return fail("executor needs prepare or lease")
  }

  if (command !== "adopt") return fail("unknown command " + command + " (see --help)")
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      path: { type: "string" },
      project: { type: "string" },
      "linear-project-id": { type: "string" },
      "linear-url": { type: "string" },
      worker: { type: "string" },
      label: { type: "string" },
      delivery: { type: "string" },
      reports: { type: "string" },
      repo: { type: "string" },
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
  const linearUrl = parsed.values["linear-url"]
  if (linearUrl !== undefined && !linearUrl.startsWith("https://linear.app/"))
    return fail("--linear-url must start with https://linear.app/")
  if (path === undefined || project === undefined || label === undefined)
    return fail("adopt needs --path, --project and --label")
  const delivery = parsed.values.delivery
  if (delivery !== undefined && delivery !== "pr" && delivery !== "trunk")
    return fail("--delivery must be pr or trunk")
  if (delivery === "pr" && pr === undefined) return fail("PR delivery needs --pr")
  if (delivery === "trunk" && pr !== undefined) return fail("trunk delivery does not take --pr")
  const number = pr === undefined ? undefined : Number(pr)
  if (number !== undefined && (!Number.isInteger(number) || number < 1))
    return fail("--pr must be a positive integer")
  const phase = parsed.values.phase
  if (!Schema.is(Phase)(phase))
    return fail("--phase must be one of reconcile, build, compress, land, blocked, done")
  const id = parsed.values.id ?? slug(number === undefined ? label : label + "-" + number)

  const result = await adopt({
    path,
    project,
    linearProjectId: parsed.values["linear-project-id"],
    linearUrl,
    worker: parsed.values.worker,
    label,
    delivery,
    reports: parsed.values.reports,
    repo: parsed.values.repo,
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
      "  delivery   " +
        (record.delivery ?? "pr") +
        (record.pr === undefined
          ? " -> " + record.base
          : " PR " + record.pr + " -> " + record.base),
      "  phase      " + record.phase,
      "  checkpoint " + record.checkpoint.sha.slice(0, 8) + " (" + record.checkpoint.ref + ")",
      "  record     " + record.id + ".json",
    ].join("\n"),
  )
}

/** The factory commands, callable from board without re-parsing another process's argv. */
export const factoryMain = async (
  argv: ReadonlyArray<string> = process.argv.slice(2),
): Promise<void> => main(argv)

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) factoryMain().catch((cause) => fail(String(cause)))
