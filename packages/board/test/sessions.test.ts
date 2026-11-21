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

  it("joins by the explicit room label, not cwd", async () => {
    const source = await discoverHerdr({
      exists: (path) => path.endsWith("/hc"),
      run: async ({ args }) =>
        args[0] === "ls" ? listing : JSON.stringify({ labels: { room: "r1" } }),
    })
    expect(source.sessions[0]).toMatchObject({
      address: "t10",
      cwd: "/repo/a",
      roomId: "r1",
      joinedBy: "label",
      labels: { room: "r1" },
    })
  })

  it("reads Rex sessions and their blocks", async () => {
    const source = await discoverRex({
      exists: (path) => path.endsWith("/rex"),
      run: async ({ args }) =>
        args[0] === "session"
          ? JSON.stringify({ sessions: [{ session_id: "session:1", label: "tackle" }] })
          : JSON.stringify({
              blocks: [
                {
                  block_id: "block:1",
                  label: "shell",
                  creator_name: "com.superlogical.terminal",
                  flavor: "com.superlogical.terminal.shell",
                  host_id: "host",
                  placement: "placed",
                  window_id: "window:1",
                },
              ],
            }),
    })
    expect(source.sessions).toEqual([
      {
        source: "rex",
        address: "block:1",
        agent: "com.superlogical.terminal",
        cwd: undefined,
        state: "placed",
        status: "com.superlogical.terminal.shell",
        turn: undefined,
        where: "tackle",
        labels: { session: "tackle", block: "shell" },
      },
    ])
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
