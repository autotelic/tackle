import assert from "node:assert/strict"
import { test } from "node:test"
import { decide, type Budget } from "./budget.ts"
import { Store } from "./store.ts"

const memoryStore = (): Store => new Store(":memory:")

test("documents round-trip as JSON, and malformed is a miss", () => {
  const store = memoryStore()
  store.setDocument("plan", { round: 1, tasks: [] })
  assert.deepEqual(store.document("plan"), { round: 1, tasks: [] })
  assert.equal(store.document("absent"), undefined)
  store.close()
})

test("a task keeps its identity, and only a running task is interrupted", () => {
  const store = memoryStore()
  const base = {
    round: 1,
    phase: "dispatch",
    role: "contract crew",
    prompt: "do the thing",
    updatedAt: 1,
  }
  store.putTask({ requestId: "f/x", status: "pending", ...base })
  store.putTask({ requestId: "f/y", status: "running", ...base })
  assert.equal(store.task("f/x")?.status, "pending")
  assert.deepEqual(
    store.interrupted().map((task) => task.requestId),
    ["f/y"],
  )
  // Re-writing a task updates its status in place — the identity is the requestId.
  store.putTask({ requestId: "f/y", status: "done", result: "ok", ...base })
  assert.equal(store.task("f/y")?.status, "done")
  assert.deepEqual(store.interrupted(), [])
  store.close()
})

const budget = (over: Partial<Budget> = {}): Budget => ({
  window: "test",
  ceilingTokens: 1000,
  ceilingUsd: 1,
  spent: { tokens: 100, usd: 0.1 },
  concurrency: 2,
  pausedUntil: null,
  note: "",
  ...over,
})

test("the budget governor stops on the ceiling, not on a feeling", () => {
  const under = decide(budget(), { tokens: 500, usd: 0.4, sessions: 1, subagents: 0 }, 0)
  assert.equal(under.ok, true)
  assert.equal(under.roundTokens, 400)

  const overTokens = decide(budget(), { tokens: 1200, usd: 0.4, sessions: 1, subagents: 0 }, 0)
  assert.equal(overTokens.ok, false)

  const overUsd = decide(budget(), { tokens: 500, usd: 1.2, sessions: 1, subagents: 0 }, 0)
  assert.equal(overUsd.ok, false)
})

test("concurrency, a pause, and an unreadable meter all yield", () => {
  assert.equal(decide(budget(), { tokens: 0, usd: 0, sessions: 0, subagents: 0 }, 2).ok, false)
  assert.equal(
    decide(
      budget({ pausedUntil: Date.now() + 60_000 }),
      { tokens: 0, usd: 0, sessions: 0, subagents: 0 },
      0,
    ).ok,
    false,
  )
  assert.equal(decide(budget(), undefined, 0).ok, false)
})
