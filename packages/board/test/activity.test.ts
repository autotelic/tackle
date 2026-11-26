import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { activityOf, progressOfPasses } from "../src/factory/activity.ts"
import { recordOf } from "../src/factory/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- fixed local receipt and event fixtures. */

const completed = (pass: number, checkpoint: string, errors: number) => ({
  pass,
  at: "2026-11-22T00:00:00.000Z",
  status: "done" as const,
  phase: "build" as const,
  events: ["task-1"],
  checkpoint,
  exit: 0,
  quality: {
    before: { available: true, errors, warnings: 0, note: "" },
    after: { available: true, errors, warnings: 0, note: "" },
    regressed: false,
  },
})

test("three passes with the same head, gate, and ticket are a stall", () => {
  expect(
    progressOfPasses([completed(1, "abc", 2), completed(2, "abc", 2), completed(3, "abc", 2)]),
  ).toEqual({
    consecutive: 3,
    stalled: true,
    signature: "abc|2|0|task-1",
  })
})

test("a changed head or a changed gate resets the stall count", () => {
  expect(
    progressOfPasses([completed(1, "abc", 2), completed(2, "def", 2), completed(3, "def", 2)])
      .consecutive,
  ).toBe(2)
  expect(
    progressOfPasses([completed(1, "abc", 2), completed(2, "abc", 1), completed(3, "abc", 1)])
      .stalled,
  ).toBe(false)
})

test("activity reports the last pass and the queued event's own words", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-activity-"))
  try {
    const home = join(root, "home")
    const directory = join(home, "workstreams", "tackle-factory.receipts")
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, "0001.json"),
      JSON.stringify({
        workstream: "tackle-factory",
        pass: 1,
        at: "2026-11-22T00:00:00.000Z",
        status: "done",
        phase: "build",
        events: ["report:one"],
        checkpoint: "abc",
        exit: 0,
      }),
    )
    writeFileSync(
      join(home, "workstreams", "tackle-factory.events.jsonl"),
      JSON.stringify({
        id: "report:two",
        kind: "report",
        at: "2026-11-22T00:20:00.000Z",
        payload: { actual: "the queue should say this" },
        status: "pending",
      }) + "\n",
    )
    const record = recordOf({
      id: "tackle-factory",
      facts: {
        project: "factory",
        label: "factory-feedback",
        repo: "autotelic/tackle",
        path: "/tmp/tackle",
        branch: "main",
        head: "abc",
        delivery: "trunk",
        pr: undefined,
        base: "main",
        baseSha: "abc",
        prHead: "abc",
        phase: "build",
        at: "2026-11-22T00:00:00.000Z",
        checkpoint: { sha: "abc", ref: "refs/bench/tackle-factory", at: "…", pushed: false },
      },
    })
    const activity = await activityOf({
      record,
      home,
      now: Date.parse("2026-11-22T00:30:00.000Z"),
    })
    expect(activity.lastPass?.pass).toBe(1)
    expect(activity.ageMinutes).toBe(30)
    expect(activity.budget).toEqual({ used: 1, passesPerPhase: 100 })
    expect(activity.pending[0]?.summary).toBe("the queue should say this")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * A receipt that says \`running\` is a claim about a process. These two pin the
 * difference between the claim and the fact: the panel and \`factory ready\` both
 * read this state, and a dead writer used to read as busy forever.
 */
const withRunningPass = async (pid: number) => {
  const root = mkdtempSync(join(tmpdir(), "factory-running-"))
  const home = join(root, "home")
  const directory = join(home, "workstreams", "tackle-factory.receipts")
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, "0001.json"),
    JSON.stringify({
      workstream: "tackle-factory",
      pass: 1,
      at: "2026-11-22T00:00:00.000Z",
      status: "running",
      phase: "land",
      events: [],
      checkpoint: "abc",
      pid,
    }),
  )
  const record = recordOf({
    id: "tackle-factory",
    facts: {
      project: "factory",
      label: "factory-feedback",
      repo: "autotelic/tackle",
      path: "/tmp/tackle",
      branch: "main",
      head: "abc",
      delivery: "trunk",
      pr: undefined,
      base: "main",
      baseSha: "abc",
      prHead: "abc",
      phase: "land",
      at: "2026-11-22T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/tackle-factory", at: "2026-11-22T00:00:00.000Z", pushed: false },
    },
  })
  const activity = await activityOf({ record, home, now: Date.parse("2026-11-22T00:01:00.000Z") })
  return { root, activity }
}

test("a running receipt whose process is alive is working", async () => {
  const { root, activity } = await withRunningPass(process.pid)
  try {
    expect(activity.state).toBe("working")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a running receipt whose process is gone is not working", async () => {
  const { root, activity } = await withRunningPass(999_999_999)
  try {
    expect(activity.state).not.toBe("working")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
