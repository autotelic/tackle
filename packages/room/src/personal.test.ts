import { describe, expect, it } from "vitest"
import {
  decodeQueue,
  emptyQueue,
  keyOf,
  planReviews,
  recordWorker,
  workerNameOf,
  type PersonalQueue,
  type ReviewTarget,
} from "./personal.ts"

/*
 * The reconciler, at the level that matters: what it raises, what it skips, and what it forgets.
 *
 * Every case here is a failure mode a review queue has already had somewhere: a duplicate worker
 * for one PR, a worker that died and was never replaced, a cooldown that spun a crashing tab, and
 * a stale key that hid the next request on the same pull request.
 */

const target = (overrides: Partial<ReviewTarget> = {}): ReviewTarget => ({
  repo: "Shakti-Reforestation/forestbuilder",
  pr: 1807,
  title: "fix(rest): paid needs every covering invoice finalized",
  url: "https://github.com/Shakti-Reforestation/forestbuilder/pull/1807",
  ...overrides,
})

const plan = (input: {
  targets?: ReadonlyArray<ReviewTarget>
  queue?: PersonalQueue
  alive?: ReadonlySet<string>
  aliveByName?: ReadonlyMap<string, string>
  now?: number
  cooldownMs?: number
  force?: boolean
}) =>
  planReviews({
    targets: input.targets ?? [target()],
    queue: input.queue ?? emptyQueue,
    now: input.now ?? 1_000_000,
    alive: input.alive ?? new Set(),
    aliveByName: input.aliveByName ?? new Map(),
    cooldownMs: input.cooldownMs ?? 6 * 3_600_000,
    force: input.force,
  })

describe("the personal review queue", () => {
  it("names the worker by repository and pull request, not by position", () => {
    expect(workerNameOf(target())).toBe("review-forestbuilder-1807")
    expect(workerNameOf(target({ pr: 9, repo: "autotelic/autotelic-geekbot" }))).toBe(
      "review-autotelic-geekbot-9",
    )
  })

  it("raises for anything the search returns on a cold start", () => {
    const first = plan({})
    expect(first.decisions).toHaveLength(1)
    expect(first.decisions[0]?.kind).toBe("raise")
    expect(first.queue.prs[keyOf(target())]).toEqual({ raisedAt: 1_000_000 })
  })

  it("adopts a running worker it does not remember, rather than launching a second", () => {
    // The first reconcile after a restart sees Rex's sessions but not the queue file.
    const adopted = plan({
      aliveByName: new Map([
        ["review-forestbuilder-1807", "window:01a1b1e7-245c-7af0-b3ef-658eff93ad6c"],
      ]),
    })
    expect(adopted.decisions[0]?.kind).toBe("skip")
    expect(adopted.decisions[0]?.worker).toBe("window:01a1b1e7-245c-7af0-b3ef-658eff93ad6c")
    expect(adopted.queue.prs[keyOf(target())]?.worker).toBe(
      "window:01a1b1e7-245c-7af0-b3ef-658eff93ad6c",
    )
  })

  it("skips while the recorded worker is alive", () => {
    const queue = recordWorker({
      queue: emptyQueue,
      target: target(),
      worker: "session:01a1b212-81bd",
      sha: "abc123",
      now: 1,
    })
    const again = plan({ queue, alive: new Set(["session:01a1b212-81bd"]), now: 50_000_000 })
    expect(again.decisions[0]?.kind).toBe("skip")
    expect(again.decisions[0]?.reason).toContain("still running")
  })

  it("re-raises once the worker is gone and the cooldown has passed", () => {
    const queue = recordWorker({
      queue: emptyQueue,
      target: target(),
      worker: "session:01a1b212-81bd",
      sha: "abc123",
      now: 1,
    })
    const dead = plan({ queue, now: 7 * 3_600_000 })
    expect(dead.decisions[0]?.kind).toBe("raise")
    expect(dead.decisions[0]?.reason).toBe("the worker is gone")
    // No worker recorded at all is the other half of the same reconciliation.
    const bare = plan({
      queue: { version: 1, prs: { [keyOf(target())]: { raisedAt: 1 } } },
      now: 7 * 3_600_000,
    })
    expect(bare.decisions[0]?.reason).toBe("raised before, no worker recorded")
  })

  it("does not spin a crashing tab: a dead worker inside the cooldown waits", () => {
    const queue = recordWorker({
      queue: emptyQueue,
      target: target(),
      worker: "session:dead",
      sha: "abc123",
      now: 1_000_000,
    })
    const soon = plan({ queue, now: 1_000_000 + 60_000 })
    expect(soon.decisions[0]?.kind).toBe("skip")
    expect(soon.decisions[0]?.reason).toContain("waiting")
  })

  it("forgets a pull request the search no longer returns", () => {
    const queue = recordWorker({
      queue: emptyQueue,
      target: target({ pr: 1792 }),
      worker: "session:01a1b212",
      sha: "abc123",
      now: 1,
    })
    const after = plan({
      targets: [target({ pr: 1807 })],
      queue,
      alive: new Set(["session:01a1b212"]),
      now: 2,
    })
    // 1792 was reviewed (the search dropped it); 1807 is new.
    expect(Object.keys(after.queue.prs)).toEqual([keyOf(target({ pr: 1807 }))])
    expect(after.decisions.map((decision) => decision.kind)).toEqual(["raise"])
  })

  it("force is the explicit override, and only that", () => {
    const queue = recordWorker({
      queue: emptyQueue,
      target: target(),
      worker: "session:alive",
      sha: "abc",
      now: 1,
    })
    expect(plan({ queue, alive: new Set(["session:alive"]), now: 2 }).decisions[0]?.kind).toBe(
      "skip",
    )
    expect(
      plan({ queue, alive: new Set(["session:alive"]), now: 2, force: true }).decisions[0]?.kind,
    ).toBe("raise")
  })

  it("treats a malformed queue file as a cold start, never as a false 'already raised'", () => {
    expect(decodeQueue("{}")).toEqual(emptyQueue)
    expect(decodeQueue("not json")).toEqual(emptyQueue)
    expect(decodeQueue('{"version":1,"prs":{}}').prs).toEqual({})
  })
})
