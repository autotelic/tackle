/* oxlint-disable plumb/prefer-property-tests -- fixed activity and desk fixtures. */
import { expect, test } from "vitest"
import type { Activity } from "../src/factory/activity.ts"
import type { DeskItem } from "../src/factory/desk.ts"
import { heldBy, truthOf } from "../src/factory/truth.ts"

const activity = (over: Partial<Activity>): Activity => ({
  workstream: "tackle-factory",
  lastPass: null,
  pending: [],
  lastEvent: null,
  ageMinutes: null,
  budget: { used: 0, passesPerPhase: 10 },
  progress: { consecutive: 0, stalled: false, signature: null },
  phase: "build",
  state: "idle",
  blockedBy: [],
  ...over,
})

const desk = (over: Partial<DeskItem>): DeskItem => ({
  id: "desk-tackle-factory-ready-3",
  workstream: "tackle-factory",
  kind: "decision",
  title: "Ready for review",
  body: "",
  choices: ["done", "continue"],
  route: "live",
  at: "2026-11-23T00:00:00.000Z",
  ...over,
})

test("a live pass is named with its pid and start, not just the word running", () => {
  const truth = truthOf({
    activity: activity({
      state: "working",
      lastPass: {
        pass: 4,
        at: "2026-11-23T01:02:03.000Z",
        status: "running",
        phase: "build",
        events: ["task-1"],
        checkpoint: undefined,
        exit: undefined,
        pid: 4242,
      },
    }),
    desk: [],
  })
  expect(truth.running).toEqual({
    pass: 4,
    pid: 4242,
    startedAt: "2026-11-23T01:02:03.000Z",
  })
  // A pass that has not captured a checkpoint has null, never a made-up sha.
  expect(truth.lastReceipt).toEqual({
    pass: 4,
    status: "running",
    at: "2026-11-23T01:02:03.000Z",
    checkpoint: null,
  })
})

test("a receipt that says running while its process is gone is not a running pass", () => {
  // activityOf asked the pid and answered queued; the stale word stays on the receipt only.
  const truth = truthOf({
    activity: activity({
      state: "queued",
      lastPass: {
        pass: 4,
        at: "2026-11-23T01:02:03.000Z",
        status: "running",
        phase: "build",
        events: [],
        checkpoint: undefined,
        exit: undefined,
        pid: 4242,
      },
      pending: [{ id: "task-1", kind: "task", at: "2026-11-23T01:05:00.000Z", summary: "x" }],
    }),
    desk: [],
  })
  expect(truth.running).toBeNull()
  expect(truth.lastReceipt?.status).toBe("running")
  expect(truth.pendingEvents).toBe(1)
})

test("pending events are counted and the queue's next one is named", () => {
  const truth = truthOf({
    activity: activity({
      pending: [
        { id: "review:17", kind: "review", at: "2026-11-23T00:10:00.000Z", summary: "fix it" },
        { id: "task-2", kind: "task", at: "2026-11-23T00:20:00.000Z", summary: "next" },
      ],
    }),
    desk: [],
  })
  expect(truth.pendingEvents).toBe(2)
  expect(truth.nextEvent).toEqual({
    id: "review:17",
    kind: "review",
    at: "2026-11-23T00:10:00.000Z",
  })
})

test("a blocked workstream with an open question is held by that question", () => {
  const truth = truthOf({
    activity: activity({ phase: "blocked", state: "blocked", blockedBy: ["phase:blocked"] }),
    desk: [desk({})],
  })
  expect(truth.openDesk).toEqual({
    id: "desk-tackle-factory-ready-3",
    title: "Ready for review",
    choices: ["done", "continue"],
  })
  expect(truth.held).toEqual({
    reason: "awaiting-answer",
    deskId: "desk-tackle-factory-ready-3",
  })
})

test("the newest open question is the one served, because it is the live one", () => {
  const truth = truthOf({
    activity: activity({ phase: "blocked", state: "blocked" }),
    desk: [
      desk({ id: "desk-old", at: "2026-11-22T00:00:00.000Z" }),
      desk({ id: "desk-new", at: "2026-11-23T05:00:00.000Z" }),
    ],
  })
  expect(truth.openDesk?.id).toBe("desk-new")
  expect(truth.held?.deskId).toBe("desk-new")
})

test("a blocked workstream with no question is still held, and says by what", () => {
  const truth = truthOf({ activity: activity({ phase: "blocked", state: "blocked" }), desk: [] })
  expect(truth.openDesk).toBeNull()
  expect(truth.held).toEqual({ reason: "phase-blocked", deskId: null })
})

test("done and idle workstreams report nothing pretending to be activity", () => {
  for (const phase of ["done", "build"] as const) {
    const truth = truthOf({
      activity: activity({ phase, state: phase === "done" ? "done" : "idle" }),
      desk: [],
    })
    expect(truth).toEqual({
      running: null,
      pendingEvents: 0,
      nextEvent: null,
      openDesk: null,
      held: null,
      lastReceipt: null,
    })
  }
})

test("a desk item raised while the workstream still works is a question, not a hold", () => {
  const item = desk({})
  expect(heldBy({ phase: "build", item })).toBeNull()
  // A retired workstream has no phase to consult; the list makes no hold claim about it.
  expect(heldBy({ phase: undefined, item })).toBeNull()
  expect(heldBy({ phase: "blocked", item })).toEqual({
    reason: "awaiting-answer",
    deskId: item.id,
  })
})
