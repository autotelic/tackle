import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { activityOf } from "../src/activity.ts"
import { recordOf } from "../src/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- fixed local receipt and event fixtures. */

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
    expect(activity.budget).toEqual({ used: 1, passesPerPhase: 5 })
    expect(activity.pending[0]?.summary).toBe("the queue should say this")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
