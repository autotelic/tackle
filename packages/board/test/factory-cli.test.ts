/* oxlint-disable plumb/prefer-property-tests -- retire is one command-boundary fixture. */
import { expect, test } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../src/factory/cli.ts", import.meta.url))

const record = {
  version: 1,
  id: "permissions-1862",
  project: "P-AUT-128",
  label: "permissions-overhaul",
  repo: "Shakti-Reforestation/forestbuilder",
  path: "/tmp/perms",
  branch: "feature/permissions-overhaul",
  head: "0".repeat(40),
  delivery: "pr",
  pr: 1862,
  base: "develop",
  baseSha: "0".repeat(40),
  prHead: "0".repeat(40),
  diverged: false,
  phase: "build",
  deps: [],
  lease: { holder: "test", generation: 1 },
  cursors: { github: "", linear: "" },
  budgets: { passesPerPhase: 5, wallMinutesPerPass: 30, tokensPerDay: 0, roundsOfChanges: 2 },
  autonomy: [],
  desk: [],
  checkpoint: {
    sha: "0".repeat(40),
    ref: "refs/bench/x",
    at: "2026-11-23T00:00:00.000Z",
    pushed: false,
  },
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
}

test("adopt-commits queues a provenance-bearing task event", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-adopt-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    writeFileSync(
      join(home, "workstreams", record.id + ".json"),
      JSON.stringify(record, null, 2) + "\n",
    )
    execFileSync(
      process.execPath,
      [
        "--conditions=development",
        cli,
        "adopt-commits",
        "--id",
        record.id,
        "--from",
        "refs/pull/1693/head",
        "--commits",
        "4bb912a,42d9240",
        "--policy",
        "keep-parent",
        "--expected-head",
        record.head,
      ],
      { encoding: "utf8", env: { ...process.env, FACTORY_HOME: home } },
    )
    const lines = readFileSync(join(home, "workstreams", record.id + ".events.jsonl"), "utf8")
      .trim()
      .split("\n")
    const event = JSON.parse(lines[0]!)
    expect(event.kind).toBe("adopt-commits")
    expect(event.payload).toEqual({
      source: "refs/pull/1693/head",
      commits: ["4bb912a", "42d9240"],
      policy: "keep-parent",
      expectedHead: record.head,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the phase gate accepts the gate card's resume answer", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-gate-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    const file = join(home, "workstreams", record.id + ".json")
    writeFileSync(file, JSON.stringify({ ...record, phase: "blocked" }, null, 2) + "\n")
    const answer = join(root, "answer.json")
    writeFileSync(answer, JSON.stringify({ choice: "resume" }))

    const output = execFileSync(
      process.execPath,
      [
        "--conditions=development",
        cli,
        "phase",
        "--id",
        record.id,
        "--set",
        "build",
        "--answer",
        answer,
      ],
      { encoding: "utf8", env: { ...process.env, FACTORY_HOME: home } },
    )
    expect(output).toContain("phase build")
    expect(JSON.parse(readFileSync(file, "utf8")).phase).toBe("build")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("retire turns a workstream off without deleting its record", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-retire-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    const file = join(home, "workstreams", record.id + ".json")
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n")

    const output = execFileSync(
      process.execPath,
      ["--conditions=development", cli, "retire", "--id", record.id],
      { encoding: "utf8", env: { ...process.env, FACTORY_HOME: home } },
    )
    expect(output).toContain("retired")
    const after = JSON.parse(readFileSync(file, "utf8"))
    expect(after.phase).toBe("done")
    expect(after.id).toBe(record.id)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * The truth a chief-of-staff loop needs, on the surface it already reads.
 *
 * The record alone says `blocked`; that is not enough to tell a parked workstream from one
 * with a live pass, a queued event, and an unanswered question.
 */
test("status serves a running pass, the queue, and the open question beside the record", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-status-"))
  try {
    const home = join(root, "home")
    const workstreams = join(home, "workstreams")
    const receipts = join(workstreams, record.id + ".receipts")
    mkdirSync(receipts, { recursive: true })
    mkdirSync(join(home, "desk"), { recursive: true })
    writeFileSync(
      join(workstreams, record.id + ".json"),
      JSON.stringify({ ...record, phase: "blocked" }, null, 2) + "\n",
    )
    writeFileSync(
      join(receipts, "0001.json"),
      JSON.stringify({
        workstream: record.id,
        pass: 1,
        at: "2026-11-23T01:00:00.000Z",
        status: "running",
        phase: "blocked",
        events: ["task-1"],
        // The test process is alive, so the child's liveness check answers yes.
        pid: process.pid,
      }) + "\n",
    )
    writeFileSync(
      join(workstreams, record.id + ".events.jsonl"),
      JSON.stringify({
        id: "task-1",
        kind: "task",
        at: "2026-11-23T00:59:00.000Z",
        payload: { task: "one small ticket" },
        status: "pending",
      }) + "\n",
    )
    writeFileSync(
      join(home, "desk", "desk-" + record.id + "-ready-1.json"),
      JSON.stringify({
        id: "desk-" + record.id + "-ready-1",
        workstream: record.id,
        kind: "decision",
        title: "Ready for review PR 1862",
        body: "",
        choices: ["done", "continue"],
        route: "live",
        at: "2026-11-23T01:01:00.000Z",
      }) + "\n",
    )
    const run = (...args: ReadonlyArray<string>): string =>
      execFileSync(process.execPath, ["--conditions=development", cli, ...args], {
        encoding: "utf8",
        env: { ...process.env, FACTORY_HOME: home },
      })

    const served = JSON.parse(run("status", "--json"))
    // The array is the contract: one record per workstream, with truth as added fields.
    expect(Array.isArray(served)).toBe(true)
    const truth = served[0]
    expect(truth.id).toBe(record.id)
    expect(truth.running).toEqual({
      pass: 1,
      pid: process.pid,
      startedAt: "2026-11-23T01:00:00.000Z",
    })
    expect(truth.pendingEvents).toBe(1)
    expect(truth.nextEvent).toEqual({
      id: "task-1",
      kind: "task",
      at: "2026-11-23T00:59:00.000Z",
    })
    expect(truth.openDesk).toEqual({
      id: "desk-" + record.id + "-ready-1",
      title: "Ready for review PR 1862",
      choices: ["done", "continue"],
    })
    expect(truth.held).toEqual({
      reason: "awaiting-answer",
      deskId: "desk-" + record.id + "-ready-1",
    })
    expect(truth.lastReceipt).toEqual({
      pass: 1,
      status: "running",
      at: "2026-11-23T01:00:00.000Z",
      checkpoint: null,
    })

    // Text has no fact the JSON lacks: a blocked record cannot read as idle here.
    const text = run("status")
    expect(text).toContain("running pass 1 pid " + process.pid)
    expect(text).toContain("pending 1")
    expect(text).toContain("next task task-1")
    expect(text).toContain("held: awaiting-answer")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a receipt left saying running with no process reads as interrupted", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-interrupted-"))
  try {
    const home = join(root, "home")
    const workstreams = join(home, "workstreams")
    const receipts = join(workstreams, record.id + ".receipts")
    mkdirSync(receipts, { recursive: true })
    writeFileSync(join(workstreams, record.id + ".json"), JSON.stringify(record, null, 2) + "\n")
    // No pid: the writer is not askable, so nothing confirms the pass is live.
    writeFileSync(
      join(receipts, "0001.json"),
      JSON.stringify({
        workstream: record.id,
        pass: 1,
        at: "2026-11-23T01:00:00.000Z",
        status: "running",
        phase: "build",
        events: [],
      }) + "\n",
    )
    const text = execFileSync(process.execPath, ["--conditions=development", cli, "status"], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_HOME: home },
    })
    expect(text).toContain("pass 1 interrupted")
    expect(text).not.toContain("running pass")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk list marks the workstream a question actually holds", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-desk-held-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    mkdirSync(join(home, "desk"), { recursive: true })
    const file = join(home, "workstreams", record.id + ".json")
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n")
    writeFileSync(
      join(home, "desk", "desk-" + record.id + "-ask.json"),
      JSON.stringify({
        id: "desk-" + record.id + "-ask",
        workstream: record.id,
        kind: "decision",
        title: "Merge or keep going?",
        body: "",
        choices: ["done", "continue"],
        route: "live",
        at: "2026-11-23T01:01:00.000Z",
      }) + "\n",
    )
    const run = (...args: ReadonlyArray<string>): string =>
      execFileSync(process.execPath, ["--conditions=development", cli, ...args], {
        encoding: "utf8",
        env: { ...process.env, FACTORY_HOME: home },
      })

    // A build-phase workstream with a queued question is not held: it can still take events.
    expect(run("desk", "list")).not.toContain("held")
    expect(JSON.parse(run("desk", "list", "--json"))[0].held).toBe(false)

    writeFileSync(file, JSON.stringify({ ...record, phase: "blocked" }, null, 2) + "\n")
    expect(run("desk", "list")).toContain("Merge or keep going?  held")
    expect(JSON.parse(run("desk", "list", "--json"))[0].held).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("status --wait refuses a JSON reader instead of printing two documents", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-wait-json-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    writeFileSync(join(home, "workstreams", record.id + ".json"), JSON.stringify(record))
    const result = spawnSync(
      process.execPath,
      ["--conditions=development", cli, "status", "--wait", "60", "--json"],
      { encoding: "utf8", env: { ...process.env, FACTORY_HOME: home } },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("--wait")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("status --wait is bounded: it prints the truth, waits once, and says nothing changed", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-wait-bounded-"))
  try {
    const home = join(root, "home")
    mkdirSync(join(home, "workstreams"), { recursive: true })
    writeFileSync(join(home, "workstreams", record.id + ".json"), JSON.stringify(record))
    const text = execFileSync(
      process.execPath,
      ["--conditions=development", cli, "status", "--wait", "1"],
      { encoding: "utf8", env: { ...process.env, FACTORY_HOME: home } },
    )
    // The record itself is still printed before the wait, so the chief sees the state it left.
    expect(text).toContain(record.id)
    expect(text).toContain("attention unchanged after 1s")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
