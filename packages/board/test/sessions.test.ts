import { describe, expect, it } from "vitest"
import { discoverHerdr, discoverRex, parseHerdr } from "../src/sessions.ts"

/* oxlint-disable plumb/prefer-property-tests -- these are two fixed wire shapes from another program. */

const listing = JSON.stringify({
  hidden_finished: 0,
  terminals: [
    {
      address: "t10",
      agent: "pi",
      cwd: "/repo/a",
      state: "live",
      status: "done",
      turn: 26,
      where: "migration / data",
    },
    { address: "t11", cwd: "/repo/b", state: "live", status: "working" },
  ],
})

describe("a session source is read, not guessed", () => {
  it("normalizes Herdr terminals", () => {
    expect(parseHerdr(listing)).toEqual([
      {
        source: "herdr",
        address: "t10",
        agent: "pi",
        cwd: "/repo/a",
        state: "live",
        status: "done",
        turn: 26,
        where: "migration / data",
      },
      {
        source: "herdr",
        address: "t11",
        agent: undefined,
        cwd: "/repo/b",
        state: "live",
        status: "working",
        turn: undefined,
        where: undefined,
      },
    ])
  })

  it("returns no sessions for malformed JSON", () => {
    expect(parseHerdr("{")).toEqual([])
  })

  it("reports unavailable when the binary is absent", async () => {
    expect(await discoverHerdr({ exists: () => false })).toEqual({
      available: false,
      sessions: [],
    })
    expect(await discoverRex({ exists: () => false })).toEqual({ available: false, sessions: [] })
  })

  it("reports available and empty when Herdr fails to answer", async () => {
    expect(
      await discoverHerdr({
        exists: (path) => path.endsWith("/hc"),
        run: async () => {
          throw new Error("no server")
        },
      }),
    ).toEqual({ available: true, sessions: [] })
  })
})
