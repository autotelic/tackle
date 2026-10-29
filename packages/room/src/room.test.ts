import { DatabaseSync } from "node:sqlite"
import { Result } from "effect"
import * as fc from "fast-check"
import type { Sql, SqlValue } from "./sql.ts"

/** `node:sqlite` for the tests; the package source only knows the `Sql` port. */
class NodeSql implements Sql {
  readonly #db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.#db = db
  }
  exec(sql: string, ...params: ReadonlyArray<SqlValue>): void {
    this.#db.prepare(sql).run(...params)
  }
  all<T>(sql: string, ...params: ReadonlyArray<SqlValue>): ReadonlyArray<T> {
    // SAFETY: the caller names the row type and the driver returns named columns.
    const rows = this.#db.prepare(sql).all(...params)
    // SAFETY: node:sqlite returns named columns; the caller names the row shape.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/no-chained-type-assertions plumb/require-safety-comment-for-type-assertion
    return rows.map((row) => row as unknown as T)
  }
  get<T>(sql: string, ...params: ReadonlyArray<SqlValue>): T | undefined {
    // SAFETY: node:sqlite returns named columns; the caller names the row shape.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/no-chained-type-assertions plumb/require-safety-comment-for-type-assertion
    return this.#db.prepare(sql).get(...params) as unknown as T | undefined
  }
  transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE")
    const value = run()
    this.#db.exec("COMMIT")
    return value
  }
}
import { describe, expect, it } from "vitest"
import { fromGithub, fromLinear } from "./ingest.ts"
import { shouldReview } from "./policy.ts"
import { inboxFor } from "./inbox.ts"
import { Ledger } from "./ledger.ts"
import type { Job } from "@autotelic/board"

const ledger = (): Ledger =>
  Ledger.open(new NodeSql(new DatabaseSync(":memory:")), "linear:p@local/t")

const job = (id: string): Job => ({
  id,
  room: "linear:p@local/t",
  kind: "review",
  pr: 1,
  sha: "abc",
  state: "queued",
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
})

describe("webhooks", () => {
  it("turns a review request into the person it addresses", () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "d1",
      now: 10,
      body: {
        action: "review_requested",
        pull_request: {
          number: 1709,
          title: "season",
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
        },
        requested_reviewer: { login: "togmund" },
      },
    })
    expect(event).toMatchObject({
      kind: "review.requested",
      pr: 1709,
      sha: "abcdef123456",
      reviewer: "togmund",
      author: "eadmundo",
      draft: false,
    })
  })

  it("degrades a malformed payload to unknown instead of throwing", () => {
    expect(fromGithub({ event: "pull_request", delivery: "d", body: "nope", now: 1 }).kind).toBe(
      "unknown",
    )
  })

  it("reads a Linear issue state", () => {
    const event = fromLinear({
      delivery: "l1",
      now: 1,
      body: { action: "update", data: { identifier: "DEV-1506", state: { name: "Done" } } },
    })
    expect(event).toMatchObject({ kind: "issue.changed", identifier: "DEV-1506", state: "Done" })
  })
})

describe("the label trigger", () => {
  const labeled = () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "d2",
      now: 10,
      body: {
        action: "labeled",
        pull_request: {
          number: 1710,
          title: "season",
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
          labels: [{ name: "multi-season" }],
        },
        label: { name: "multi-season" },
      },
    })
    return event
  }

  it("turns a labeled PR into a pr.ready event with its labels", () => {
    expect(labeled()).toMatchObject({
      kind: "pr.ready",
      pr: 1710,
      author: "eadmundo",
      labels: ["multi-season"],
    })
  })

  it("acts on the label, without a review request", () => {
    expect(shouldReview({ event: labeled(), actor: "github:togmund", label: "multi-season" })).toBe(
      true,
    )
  })

  it("does not review its own actor's PR", () => {
    expect(
      shouldReview({ event: labeled(), actor: "github:eadmundo", label: "multi-season" }),
    ).toBe(false)
  })

  it("does not act on a different label", () => {
    expect(shouldReview({ event: labeled(), actor: "github:togmund", label: "payroll" })).toBe(
      false,
    )
  })
})

describe("workers", () => {
  it("records and refreshes a worker session", () => {
    const store = ledger()
    store.putWorker({
      name: "room-1-fix",
      room: store.room,
      pr: 1,
      kind: "fix",
      address: "t2",
      worktree: "/tmp/wt",
      state: "live",
      startedAt: 1,
      updatedAt: 1,
    })
    expect(store.workers()).toHaveLength(1)
    store.putWorker({
      name: "room-1-fix",
      room: store.room,
      pr: 1,
      kind: "fix",
      address: "t2",
      worktree: "/tmp/wt",
      state: "done",
      startedAt: 1,
      updatedAt: 2,
    })
    expect(store.workers()[0]?.state).toBe("done")
  })
})

describe("the project inbox", () => {
  it("dedupes by delivery id and acknowledges", () => {
    const store = ledger()
    expect(
      store.enqueueInbox({ id: "i1", kind: "turn", pr: 1, text: "hi", at: 1, holdUntil: 0 }),
    ).toBe(true)
    expect(
      store.enqueueInbox({ id: "i1", kind: "turn", pr: 1, text: "hi", at: 1, holdUntil: 0 }),
    ).toBe(false)
    const items = store.inbox(0, 10_000)
    expect(items).toHaveLength(1)
    expect(store.ackInbox([items[0]?.seq ?? 0], 2)).toBe(1)
    expect(store.inbox(0, 10_000)).toHaveLength(0)
  })

  it("batches a sweep on one PR until the hold expires", () => {
    const store = ledger()
    store.enqueueInbox({
      id: "b1",
      kind: "turn",
      pr: 9,
      text: "first",
      at: 1_000,
      holdUntil: 2_000,
    })
    store.enqueueInbox({
      id: "b2",
      kind: "turn",
      pr: 9,
      text: "second",
      at: 1_500,
      holdUntil: 3_000,
    })
    expect(store.inbox(0, 2_500)).toHaveLength(0)
    const items = store.inbox(0, 3_000)
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toContain("first")
    expect(items[0]?.text).toContain("second")
  })

  it("routes Ed's comment as a turn and stays quiet on the actor's own", () => {
    const event = fromGithub({
      event: "pull_request_review_comment",
      delivery: "c1",
      now: 1,
      body: {
        action: "created",
        pull_request: {
          number: 1709,
          user: { login: "togmund" },
          head: { sha: "abcdef" },
        },
        comment: {
          id: 9,
          user: { login: "eadmundo" },
          path: "services/a.ts",
          line: 224,
          body: "The season resolves from the wrong row.",
        },
      },
    })
    const draft = Result.getOrUndefined(inboxFor({ event, actor: "github:togmund" }))
    expect(draft?.kind).toBe("turn")
    expect(draft?.text).toContain("eadmundo commented on #1709")
    expect(Result.isFailure(inboxFor({ event, actor: "github:eadmundo" }))).toBe(true)
  })

  it("turns a label into a card, not a turn", () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "l1",
      now: 1,
      body: {
        action: "labeled",
        pull_request: {
          number: 1710,
          user: { login: "eadmundo" },
          head: { sha: "abcdef" },
          labels: [{ name: "multi-season" }],
        },
        label: { name: "multi-season" },
      },
    })
    expect(Result.getOrUndefined(inboxFor({ event, actor: "github:togmund" }))?.kind).toBe("card")
  })
})

describe("ledger", () => {
  it("property: every successful claim advances the epoch", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (times) => {
        const store = ledger()
        let epoch = 0
        for (let index = 0; index < times; index += 1) {
          const outcome = store.claim("c", "a@x", "github:a", 60_000, 1_000 + index * 1_000)
          if (outcome.ok) epoch = outcome.epoch
        }
        return epoch === times
      }),
    )
  })

  it("fences a claim by host and epoch", () => {
    const store = ledger()
    expect(store.claim("c", "a@x", "github:a", 60_000, 1_000)).toEqual({ ok: true, epoch: 1 })
    expect(store.claim("c", "b@x", "github:b", 60_000, 2_000)).toMatchObject({
      ok: false,
      reason: "held",
    })
    expect(store.claim("c", "a@x", "github:a", 60_000, 3_000)).toEqual({ ok: true, epoch: 2 })
  })

  it("frees an expired claim but still advances the epoch", () => {
    const store = ledger()
    store.claim("c", "a@x", "github:a", 1_000, 1_000)
    expect(store.claim("c", "b@x", "github:b", 60_000, 5_000)).toEqual({ ok: true, epoch: 2 })
  })

  it("dedupes a webhook receipt by delivery id", () => {
    const store = ledger()
    const receipt = { id: "d1", room: store.room, at: 1, kind: "review.requested" }
    expect(store.append(receipt)).toBe(true)
    expect(store.append(receipt)).toBe(false)
  })

  it("enqueues a job once per id", () => {
    const store = ledger()
    expect(store.enqueue(job("pr:1:abc"))).toBe(true)
    expect(store.enqueue(job("pr:1:abc"))).toBe(false)
  })

  it("claims a queued job and reports an interrupted one as claimed, not done", () => {
    const store = ledger()
    store.enqueue(job("pr:1:abc"))
    const claimed = Result.getOrUndefined(store.claimJob("a@x", 10))
    expect(claimed?.state).toBe("claimed")
    expect(store.jobs()[0]?.state).toBe("claimed")
  })
})
