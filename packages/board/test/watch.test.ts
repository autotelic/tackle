import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Result from "effect/Result"
import { expect, test } from "vitest"
import { answerDesk, listDesk, raiseDesk } from "../src/factory/desk.ts"
import { readEvents } from "../src/factory/events.ts"
import { readWorkstream, recordOf, writeWorkstream, type Workstream } from "../src/factory/store.ts"
import {
  baseEvents,
  deskEvents,
  githubEvents,
  shouldWake,
  watchOnce,
  type WatchEvent,
} from "../src/factory/watch.ts"

/* oxlint-disable plumb/prefer-property-tests, no-reinterpret-cast, require-safety-comment-for-type-assertion -- the fixtures are trusted local JSON and the test shape is the assertion. */

const fixture = <A>(name: string): A =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL("./factory-fixtures/" + name, import.meta.url)), "utf8"),
  ) as A

const base = (): Workstream =>
  recordOf({
    id: "perms-1862",
    facts: {
      project: "P-AUT-128",
      delivery: "pr",
      label: "permissions-overhaul",
      repo: "Shakti-Reforestation/forestbuilder",
      path: "/tmp/perms",
      branch: "feature/permissions-overhaul",
      head: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      pr: 1862,
      base: "develop",
      baseSha: "6e4f4ffc8",
      prHead: "55aa5293a4b9d0f7f0e1c1b6a1f0d3c8e7b6a5d4",
      phase: "build",
      at: "2026-11-21T22:00:00.000Z",
      checkpoint: { sha: "55aa5293a", ref: "refs/bench/perms-1862", at: "…", pushed: true },
    },
  })

type WakeFixture = {
  readonly cases: ReadonlyArray<{
    readonly name: string
    readonly given: {
      readonly workstream?: {
        readonly phase?: "blocked"
        readonly budget?: { readonly passes?: { readonly used: number; readonly of: number } }
      }
      readonly event: {
        readonly id: string
        readonly kind: string
        readonly at: string
        readonly headSha?: string
        readonly actor?: string
      }
    }
    readonly expected: { readonly wake: boolean }
  }>
}

test("a trunk workstream watches its base branch, not a PR", () => {
  const record = {
    ...base(),
    delivery: "trunk" as const,
    pr: undefined,
    base: "main",
    cursors: { ...base().cursors, github: "2026-11-21T23:00:00.000Z" },
  }
  const sha = "ab12cd34"
  const at = "2026-11-21T23:30:00.000Z"
  const runGit = (args: ReadonlyArray<string>) =>
    args[0] === "merge-base"
      ? Result.fail("not an ancestor")
      : args[0] === "rev-parse"
        ? Result.succeed(sha)
        : args[0] === "log"
          ? Result.succeed(sha + "\u0000" + at + "\u0000base moved")
          : Result.succeed("")
  const events = baseEvents({ record, runGit })
  expect(events).toHaveLength(1)
  expect(events[0]?.id).toBe("base:commit:" + sha)
  expect(events[0]?.headSha).toBe(sha)
  expect(
    baseEvents({
      record: { ...record, cursors: { ...record.cursors, github: at } },
      runGit,
    }),
  ).toEqual([])
})

const githubChecks = (checks: ReadonlyArray<unknown>) => {
  const sha = base().head
  return (args: ReadonlyArray<string>) => {
    expect(args.join(" ")).toContain("statusCheckRollup")
    return Result.succeed(
      JSON.stringify({
        headRefOid: sha,
        reviews: [],
        comments: [],
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        statusCheckRollup: checks,
      }),
    )
  }
}

test("a failed check becomes a check event for the head", () => {
  const sha = base().head
  const events = githubEvents({
    record: base(),
    at: "2026-11-21T23:30:00.000Z",
    runGh: githubChecks([
      {
        __typename: "CheckRun",
        name: "check",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: "2026-11-21T23:29:00.000Z",
      },
      {
        __typename: "CheckRun",
        name: "test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-11-21T23:28:00.000Z",
      },
    ]),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe("check")
  expect(events[0]?.headSha).toBe(sha)
  expect(events[0]?.id).toContain(":failed:")
  expect(events[0]?.payload).toMatchObject({ state: "failed", failed: ["check"] })
})

test("a fully green check rollup becomes one check event", () => {
  const events = githubEvents({
    record: base(),
    at: "2026-11-21T23:30:00.000Z",
    runGh: githubChecks([
      {
        __typename: "CheckRun",
        name: "check",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        completedAt: "2026-11-21T23:29:00.000Z",
      },
      { __typename: "StatusContext", context: "vercel", state: "SUCCESS" },
    ]),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe("check")
  expect(events[0]?.id).toContain(":passed:")
  expect(events[0]?.payload).toMatchObject({ state: "passed", failed: [] })
})

test("a merged PR becomes a retirement event and nothing else", () => {
  const sha = base().head
  const events = githubEvents({
    record: base(),
    at: "2026-11-21T23:30:00.000Z",
    runGh: () =>
      Result.succeed(
        JSON.stringify({
          headRefOid: sha,
          reviews: [],
          comments: [],
          state: "MERGED",
          mergedAt: "2026-11-21T23:29:00.000Z",
          mergeCommit: { oid: "abc123" },
        }),
      ),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe("merged")
  expect(events[0]?.id).toBe("github:merged:1862:abc123")
})

test("a passed check at the current checkpoint is consumed without a pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-check-head-"))
  try {
    const record = { ...base(), phase: "build" as const }
    await writeWorkstream({ record, home: root })
    const outcome = await watchOnce({
      id: record.id,
      home: root,
      at: "2026-11-24T00:00:00.000Z",
      events: [
        {
          id: "check-1",
          kind: "check",
          at: "2026-11-24T00:00:00.000Z",
          payload: { state: "passed", headRefOid: record.checkpoint.sha },
        },
      ],
      runGh: githubChecks([]),
    })
    expect(outcome.passes).toEqual([])
    expect((await readEvents({ id: record.id, home: root }))[0]?.status).toBe("consumed")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a failed check is recorded as advisory and never starts a pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-check-advisory-"))
  try {
    const record = { ...base(), phase: "build" as const }
    await writeWorkstream({ record, home: root })
    const outcome = await watchOnce({
      id: record.id,
      home: root,
      at: "2026-11-24T00:00:00.000Z",
      events: [
        {
          id: "check-failed-1",
          kind: "check",
          at: "2026-11-24T00:00:00.000Z",
          payload: { state: "failed", headRefOid: record.head },
        },
      ],
      runGh: githubChecks([]),
    })
    expect(outcome.passes).toEqual([])
    expect((await readEvents({ id: record.id, home: root }))[0]?.status).toBe("consumed")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an exhausted pass budget no longer stops a queued event or raises a cap card", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-cap-"))
  try {
    const record = {
      ...base(),
      phase: "build" as const,
      budgets: { ...base().budgets, passesPerPhase: 0 },
    }
    await writeWorkstream({ record, home: root })
    await watchOnce({
      id: record.id,
      home: root,
      at: "2026-11-24T00:00:00.000Z",
      events: [
        {
          id: "task-1",
          kind: "task",
          at: "2026-11-24T00:00:00.000Z",
          payload: {},
        },
      ],
      runGh: githubChecks([]),
    })
    const desks = await listDesk({ home: root })
    expect(desks.some((item) => item.title.startsWith("Pass budget reached"))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a merged PR closes the pending ready desk", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-merged-desk-"))
  try {
    const record = { ...base(), phase: "build" as const }
    await writeWorkstream({ record, home: root })
    await raiseDesk({
      home: root,
      item: {
        id: "ready-1",
        workstream: record.id,
        kind: "decision",
        title: "Ready to merge",
        body: "Land it?",
        choices: ["done", "continue"],
        route: "live",
        at: "2026-11-22T00:00:00.000Z",
      },
    })
    await watchOnce({
      id: record.id,
      home: root,
      at: "2026-11-22T00:06:00.000Z",
      runGh: () =>
        Result.succeed(
          JSON.stringify({
            headRefOid: record.head,
            reviews: [],
            comments: [],
            state: "MERGED",
            mergedAt: "2026-11-22T00:05:00.000Z",
            mergeCommit: { oid: "abc123" },
          }),
        ),
    })
    expect(await listDesk({ home: root })).toEqual([])
    expect((await readWorkstream({ id: record.id, home: root }))?.phase).toBe("done")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a done desk answer retires the workstream without a pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-done-"))
  try {
    const record = { ...base(), phase: "build" as const }
    await writeWorkstream({ record, home: root })
    await raiseDesk({
      home: root,
      item: {
        id: "ready-1",
        workstream: record.id,
        kind: "decision",
        title: "Ready to merge",
        body: "Land it?",
        choices: ["done", "continue"],
        route: "live",
        at: "2026-11-22T00:00:00.000Z",
      },
    })
    await answerDesk({
      home: root,
      answer: {
        item: "ready-1",
        choice: "done",
        by: "human",
        at: "2026-11-22T00:05:00.000Z",
      },
    })
    const outcome = await watchOnce({
      id: record.id,
      home: root,
      at: "2026-11-22T00:06:00.000Z",
      runGh: githubChecks([]),
    })
    expect(outcome.passes).toEqual([])
    expect((await readWorkstream({ id: record.id, home: root }))?.phase).toBe("done")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a moved parent branch becomes a parent wake", () => {
  const record = base()
  const events = githubEvents({
    record,
    at: "2026-11-24T00:00:00.000Z",
    runGh: () =>
      Result.succeed(
        JSON.stringify({
          headRefOid: record.head,
          baseRefOid: "new-parent-sha",
          reviews: [],
          comments: [],
          statusCheckRollup: [],
        }),
      ),
  })
  expect(events).toContainEqual(
    expect.objectContaining({
      id: "github:parent:new-parent-sha",
      kind: "parent",
      payload: expect.objectContaining({ baseRefOid: "new-parent-sha" }),
    }),
  )
})

test("a check rollup without timestamps keeps a stable event id", () => {
  const runGh = githubChecks([{ __typename: "StatusContext", context: "vercel", state: "SUCCESS" }])
  const first = githubEvents({ record: base(), at: "2026-11-21T23:30:00.000Z", runGh })
  const second = githubEvents({ record: base(), at: "2026-11-21T23:31:00.000Z", runGh })
  expect(first[0]?.id).toBe(second[0]?.id)
})

test("a pending check rollup stays silent until every check has finished", () => {
  const events = githubEvents({
    record: base(),
    at: "2026-11-21T23:30:00.000Z",
    runGh: githubChecks([
      {
        __typename: "CheckRun",
        name: "check",
        status: "IN_PROGRESS",
        conclusion: null,
        completedAt: null,
      },
    ]),
  })
  expect(events).toEqual([])
})

test("a failed check is still actionable while another check is pending", () => {
  const events = githubEvents({
    record: base(),
    at: "2026-11-21T23:30:00.000Z",
    runGh: githubChecks([
      {
        __typename: "CheckRun",
        name: "check",
        status: "COMPLETED",
        conclusion: "FAILURE",
        completedAt: "2026-11-21T23:29:00.000Z",
      },
      { __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null },
    ]),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.payload).toMatchObject({ state: "failed" })
})

test("a desk answer becomes an event for its own workstream", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-desk-event-"))
  try {
    const desk = join(root, "desk")
    mkdirSync(desk, { recursive: true })
    writeFileSync(
      join(desk, "d1.json"),
      JSON.stringify({
        id: "d1",
        workstream: "perms-1862",
        kind: "decision",
        title: "Choose",
        body: "Test",
        choices: ["yes"],
        route: "live",
        at: "2026-11-22T00:00:00.000Z",
      }),
    )
    writeFileSync(
      join(desk, "d1.answer.json"),
      JSON.stringify({
        item: "d1",
        choice: "yes",
        by: "human",
        at: "2026-11-22T00:05:00.000Z",
      }),
    )
    const events = await deskEvents({ record: base(), home: root })
    expect(events[0]?.kind).toBe("desk")
    expect(events[0]?.id).toContain("d1")
    expect(events[0]?.payload).toMatchObject({ choice: "yes", by: "human" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the six wake cases agree with the decision", () => {
  const data = fixture<WakeFixture>("watch/wake-cases.json")
  for (const item of data.cases) {
    const record =
      item.given.workstream?.phase === undefined
        ? base()
        : { ...base(), phase: item.given.workstream.phase }
    const event: WatchEvent = { ...item.given.event, payload: {} }
    const decision = shouldWake({
      record,
      event,
      consumed: ["github:review-comment:2048113377"],
      passesUsed: item.given.workstream?.budget?.passes?.used ?? 0,
    })
    expect(decision.wake, item.name).toBe(item.expected.wake)
  }
})

test("Linear offsets normalize to instants, so the same cursor returns the same new events", () => {
  const data = fixture<{
    readonly events: ReadonlyArray<{ readonly id: string; readonly updatedAt: string }>
    readonly cases: ReadonlyArray<{
      readonly cursor: string
      readonly mustReturn: ReadonlyArray<string>
    }>
  }>("cursor/linear.offset-pair.json")
  const byId = new Map(data.events.map((event) => [event.id, event]))
  for (const item of data.cases) {
    const cursor = byId.get(item.cursor)
    expect(cursor, item.cursor).toBeDefined()
    if (cursor === undefined) continue
    const since = Date.parse(cursor.updatedAt)
    const after = data.events
      .filter((event) => Date.parse(event.updatedAt) > since)
      .map((e) => e.id)
    expect(after, item.cursor).toEqual(item.mustReturn)
  }
})
