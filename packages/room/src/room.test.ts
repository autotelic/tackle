import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { fromGithub, fromLinear } from "./ingest.ts"
import { Ledger } from "./ledger.ts"
import { NodeSql } from "./node-sql.ts"
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

describe("ledger", () => {
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
    const claimed = store.claimJob("a@x", 10)
    expect(claimed?.state).toBe("claimed")
    expect(store.jobs()[0]?.state).toBe("claimed")
  })
})
