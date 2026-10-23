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
    expect(roomOf("p", stageOf("Togmund"))).toBe("linear:p@local/togmund")
  })

  it("makes a thread address out of ticket, pr, path, and line", () => {
    expect(chitOf("DEV-1506", 1709, "services/a.ts", 224)).toBe("dev-1506@1709#services/a.ts:224")
  })

  it("keeps a job id stable for one head sha", () => {
    expect(jobOf(1709, "abcdef1234567890")).toBe(jobOf(1709, "abcdef1234567890"))
    expect(jobOf(1709, "1111111111111111")).not.toBe(jobOf(1709, "2222222222222222"))
  })

  it("puts the room and the sha in the review marker", () => {
    expect(markerOf("linear:p@local/t", "abcdef1234567890")).toBe(
      "<!-- room:linear:p@local/t sha:abcdef123456 -->",
    )
  })

  it("lowercases the login but not the project id", () => {
    expect(hostOf("Togmund", "Laptop.local")).toBe("togmund@laptop.local")
    expect(actorOf("Togmund")).toBe("github:togmund")
    expect(roomOf("AbC", "local/t")).toBe("linear:AbC@local/t")
  })
})

describe("claims", () => {
  it("refuses a second live holder", () => {
    const first = claimOf({ host: "a@x", expiresAt: 2_000 })
    const result = acquire({ claims: [first], now: 1_000, host: "b@x" })
    expect(result.ok).toBe(false)
  })

  it("lets the same host re-acquire and advances the epoch", () => {
    const first = claimOf({ host: "a@x", epoch: 4, expiresAt: 2_000 })
    const result = acquire({ claims: [first], now: 1_000, host: "a@x" })
    expect(result).toEqual({ ok: true, epoch: 5 })
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
    const claims = fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 })
    fc.assert(
      fc.property(claims, (epochs) => {
        const list = epochs.map((epoch) => claimOf({ epoch }))
        return nextEpoch(list) > Math.max(0, ...epochs)
      }),
    )
  })

  it("property: one live claim per chit is never a conflict", () => {
    const owners = fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 20 })
    fc.assert(
      fc.property(owners, (hosts) => {
        const claims = hosts.map((host, index) =>
          claimOf({ chit: `chit-${index}`, host: `${host}@x` }),
        )
        return conflicts(claims, 1_000).length === 0
      }),
    )
  })
})

describe("readers", () => {
  it("returns undefined for a record that says nothing usable", () => {
    expect(decodeChit({})).toBeUndefined()
    expect(decodeChit({ id: "x", room: "r", ticket: "t" })).toBeUndefined()
  })

  it("degrades a malformed optional field, not the record", () => {
    const chit = decodeChit({
      id: "x",
      room: "r",
      ticket: "t",
      kind: "thread",
      state: "open",
      anchor: { pr: 1, sha: "abc", line: "not a number" },
    })
    expect(chit?.anchor).toEqual({ pr: 1, sha: "abc" })
  })

  it("decodes a claim only with every required field", () => {
    expect(decodeClaim({ chit: "c", room: "r", host: "h", actor: "a", epoch: 1 })).toBeUndefined()
    expect(
      decodeClaim({ chit: "c", room: "r", host: "h", actor: "a", epoch: 1, expiresAt: 2 }),
    ).toBeDefined()
  })
})
