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
    expect(activity.pending[0]?.summary).toBe("the queue should say this")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const recordAt = (input: { readonly id: string }) =>
  recordOf({
    id: input.id,
    facts: {
      project: "factory",
      label: input.id,
      repo: "autotelic/tackle",
      path: "/tmp/" + input.id,
      branch: "main",
      head: "abc",
      delivery: "trunk",
      pr: undefined,
      base: "main",
      baseSha: "abc",
      prHead: "abc",
      phase: "build",
      at: "2026-11-22T00:00:00.000Z",
      checkpoint: {
        sha: "aaa111",
        ref: "refs/bench/" + input.id,
        at: "2026-11-22T00:10:00.000Z",
        pushed: false,
      },
    },
  })

interface ReceiptBody {
  readonly at: string
  readonly endedAt?: string
  readonly status: "running" | "done" | "failed"
  readonly checkpoint?: string
  readonly exit?: number
}

test("timeline keeps each pass's start, end and receipt sha, and marks a ship", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-timeline-"))
  try {
    const home = join(root, "home")
    const id = "tackle-timeline"
    const directory = join(home, "workstreams", id + ".receipts")
    mkdirSync(directory, { recursive: true })
    const receipt = (pass: number, body: ReceiptBody) =>
      writeFileSync(
        join(directory, String(pass).padStart(4, "0") + ".json"),
        JSON.stringify({
          workstream: id,
          pass,
          phase: "build",
          events: [],
          ...body,
        }),
      )
    receipt(1, {
      at: "2026-11-22T00:00:00.000Z",
      endedAt: "2026-11-22T00:10:00.000Z",
      status: "done",
      checkpoint: "aaa111",
      exit: 0,
    })
    receipt(2, {
      at: "2026-11-22T00:20:00.000Z",
      endedAt: "2026-11-22T00:21:00.000Z",
      status: "failed",
      exit: 1,
    })
    receipt(3, { at: "2026-11-22T00:30:00.000Z", status: "running" })

    const base = recordAt({ id })
    const record = { ...base, phase: "done" as const, updatedAt: "2026-11-22T00:40:00.000Z" }
    const activity = await activityOf({
      record,
      home,
      now: Date.parse("2026-11-22T00:50:00.000Z"),
    })

    const events = activity.timeline.events
    expect(events.map((event) => event.kind)).toEqual([
      "pass",
      "checkpoint",
      "pass",
      "pass",
      "ship",
    ])
    expect(events[0]).toMatchObject({
      kind: "pass",
      at: "2026-11-22T00:00:00.000Z",
      endedAt: "2026-11-22T00:10:00.000Z",
      status: "done",
      pass: 1,
      sha: "aaa111",
    })
    expect(events[1]).toMatchObject({
      kind: "checkpoint",
      at: "2026-11-22T00:10:00.000Z",
      sha: "aaa111",
    })
    expect(events[2]).toMatchObject({ kind: "pass", status: "failed", pass: 2 })
    expect(events[3]).toMatchObject({ kind: "pass", status: "running", pass: 3 })
    expect(events[4]).toMatchObject({
      kind: "ship",
      at: "2026-11-22T00:40:00.000Z",
      sha: "aaa111",
    })
    expect(activity.lastPass?.endedAt).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a workstream with no passes still carries its checkpoint and closed phase", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-timeline-empty-"))
  try {
    const home = join(root, "home")
    const id = "tackle-adopted"
    const record = {
      ...recordAt({ id }),
      phase: "done" as const,
      updatedAt: "2026-11-22T00:20:00.000Z",
    }
    const activity = await activityOf({
      record,
      home,
      now: Date.parse("2026-11-22T00:30:00.000Z"),
    })
    expect(activity.timeline.events).toEqual([
      { kind: "checkpoint", at: "2026-11-22T00:10:00.000Z", sha: "aaa111" },
      { kind: "ship", at: "2026-11-22T00:20:00.000Z", sha: "aaa111" },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
