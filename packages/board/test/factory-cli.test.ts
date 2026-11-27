/* oxlint-disable plumb/prefer-property-tests -- retire is one command-boundary fixture. */
import { expect, test } from "vitest"
import { execFileSync } from "node:child_process"
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
