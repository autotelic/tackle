import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { actorOf, chitOf, hostOf, jobOf, markerOf, roomOf, stageOf } from "./ids.ts"
import { decodeChit, decodeClaim } from "./decode.ts"
import { acquire, conflicts, isLive, liveClaims, nextEpoch } from "./invariants.ts"
import type { Claim } from "./records.ts"
import * as fc from "fast-check"

const claimOf = (overrides: Partial<Claim> = {}): Claim => ({
  chit: "dev-1@1#a.ts:1",
  room: "linear:p@local/t",
  host: "t@laptop",
  actor: actorOf("t"),
  epoch: 1,
  expiresAt: 1_000,
  ...overrides,
})

describe("identities", () => {
  it("derives the same room from the same project and stage", () => {
    expect(roomOf({ projectId: "p", stage: stageOf("Togmund") })).toBe("linear:p@local/togmund")
  })

  it("makes a thread address out of ticket, pr, path, and line", () => {
    expect(chitOf({ ticket: "DEV-1506", pr: 1709, path: "services/a.ts", line: 224 })).toBe(
      "dev-1506@1709#services/a.ts:224",
    )
  })

  it("keeps a job id stable for one head sha", () => {
    expect(jobOf({ pr: 1709, sha: "abcdef1234567890" })).toBe(
      jobOf({ pr: 1709, sha: "abcdef1234567890" }),
    )
    expect(jobOf({ pr: 1709, sha: "1111111111111111" })).not.toBe(
      jobOf({ pr: 1709, sha: "2222222222222222" }),
    )
  })

  it("puts the room and the sha in the review marker", () => {
    expect(markerOf({ room: "linear:p@local/t", sha: "abcdef1234567890" })).toBe(
      "<!-- room:linear:p@local/t sha:abcdef123456 -->",
    )
  })

  it("lowercases the login but not the project id", () => {
    expect(hostOf({ login: "Togmund", hostname: "Laptop.local" })).toBe("togmund@laptop.local")
    expect(actorOf("Togmund")).toBe("github:togmund")
    expect(roomOf({ projectId: "AbC", stage: "local/t" })).toBe("linear:AbC@local/t")
  })
})

describe("claims", () => {
  it("refuses a second live holder", () => {
    const first = claimOf({ host: "a@x", expiresAt: 2_000 })
    expect(acquire({ claims: [first], now: 1_000, host: "b@x" }).ok).toBe(false)
  })

  it("lets the same host re-acquire and advances the epoch", () => {
    const first = claimOf({ host: "a@x", epoch: 4, expiresAt: 2_000 })
    expect(acquire({ claims: [first], now: 1_000, host: "a@x" })).toEqual({ ok: true, epoch: 5 })
  })

  it("treats an expired claim as free but still fences the epoch", () => {
    const expired = claimOf({ host: "a@x", epoch: 7, expiresAt: 500 })
    expect(isLive(expired, 1_000)).toBe(false)
    expect(acquire({ claims: [expired], now: 1_000, host: "b@x" })).toEqual({
      ok: true,
      epoch: 8,
    })
  })

  it("keeps live claims only", () => {
    const claims = [claimOf({ expiresAt: 500 }), claimOf({ host: "b@x", expiresAt: 2_000 })]
    expect(liveClaims(claims, 1_000)).toHaveLength(1)
  })

  it("property: nextEpoch is greater than every epoch seen", () => {
    const epochs = fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 })
    fc.assert(
      fc.property(epochs, (values) => {
        const list = values.map((epoch) => claimOf({ epoch }))
        return nextEpoch(list) > Math.max(0, ...values)
      }),
    )
  })

  it("property: one live claim per chit is never a conflict", () => {
    const hosts = fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 20 })
    fc.assert(
      fc.property(hosts, (values) => {
        const claims = values.map((host, index) =>
          claimOf({ chit: `chit-${index}`, host: `${host}@x` }),
        )
        return conflicts(claims, 1_000).length === 0
      }),
    )
  })
})

describe("readers", () => {
  it("returns None for a record that says nothing usable", () => {
    expect(Result.isFailure(decodeChit({}))).toBe(true)
    expect(Result.isFailure(decodeChit({ id: "x", room: "r", ticket: "t" }))).toBe(true)
  })

  it("rejects a record with a malformed field instead of inventing a value", () => {
    const chit = decodeChit({
      id: "x",
      room: "r",
      ticket: "t",
      kind: "thread",
      state: "open",
      updatedAt: 1,
      anchor: { pr: 1, sha: "abc", line: "not a number" },
    })
    expect(Result.isFailure(chit)).toBe(true)
  })

  it("decodes a claim only with every required field", () => {
    expect(
      Result.isFailure(decodeClaim({ chit: "c", room: "r", host: "h", actor: "a", epoch: 1 })),
    ).toBe(true)
    expect(
      Result.isSuccess(
        decodeClaim({ chit: "c", room: "r", host: "h", actor: "a", epoch: 1, expiresAt: 2 }),
      ),
    ).toBe(true)
  })
})
