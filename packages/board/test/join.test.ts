import { describe, expect, it } from "vitest"
import { joinSessions } from "../src/join.ts"
import type { Session } from "../src/sessions.ts"

/* oxlint-disable plumb/prefer-property-tests -- these are two fixed path identities, not a domain. */

const session = (cwd: string): Session => ({
  source: "herdr",
  address: "t1",
  agent: "pi",
  cwd,
  state: "live",
  status: "working",
  turn: 3,
  where: "tackle",
})

const identity = async (path: string): Promise<string> => path

describe("a session joins its room by resolved worktree", () => {
  it("resolves the two names of one tree before matching", async () => {
    const joined = await joinSessions({
      sessions: [session("/var/rooms/r1/worktree/src")],
      rooms: [{ id: "r1", worktree: "/private/var/rooms/r1/worktree" }],
      realpath: async (path) => path.replace("/private/var", "/var"),
    })
    expect(joined[0]).toMatchObject({ roomId: "r1", joinedBy: "cwd" })
  })

  it("uses the longest worktree when one contains another", async () => {
    const joined = await joinSessions({
      sessions: [session("/repo/.room/inner/worktree/src")],
      rooms: [
        { id: "outer", worktree: "/repo" },
        { id: "inner", worktree: "/repo/.room/inner/worktree" },
      ],
      realpath: identity,
    })
    expect(joined[0]).toMatchObject({ roomId: "inner", joinedBy: "cwd" })
  })

  it("leaves a session outside every worktree unjoined", async () => {
    const joined = await joinSessions({
      sessions: [session("/elsewhere")],
      rooms: [{ id: "r1", worktree: "/repo/.room/r1/worktree" }],
      realpath: identity,
    })
    expect(joined[0]).not.toHaveProperty("roomId")
    expect(joined[0]?.cwd).toBe("/elsewhere")
  })
})
