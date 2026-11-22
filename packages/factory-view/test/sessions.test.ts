/* oxlint-disable plumb/prefer-property-tests -- these are the fixed wire shapes of two other programs. */
import { describe, expect, it } from "vitest"
import { sessionCommand, sessionLiveStatus } from "../src/main.ts"
import { herdrBlocked, herdrDone, herdrLive, rexBlocked } from "./fixtures.ts"

describe("the attach command", () => {
  it("attaches a Herdr terminal by its address", () => {
    expect(sessionCommand(herdrLive)).toBe("hc attach t1d")
  })

  it("focuses the Rex session by label, not by block id", () => {
    expect(sessionCommand(rexBlocked)).toBe("rex block focus -s tackle")
  })

  it("quotes a label a shell would split", () => {
    expect(sessionCommand({ ...rexBlocked, where: "factory view" })).toBe(
      "rex block focus -s 'factory view'",
    )
  })
})

describe("the normalized status", () => {
  it("calls a working pane live and keeps the verbatim word for the view", () => {
    expect(sessionLiveStatus(herdrLive)).toBe("live")
    expect(herdrLive.status).toBe("working")
  })

  it("normalizes done to idle without pretending done means idle", () => {
    expect(sessionLiveStatus(herdrDone)).toBe("idle")
    expect(herdrDone.status).toBe("done")
  })

  it("keeps blocked blocked", () => {
    expect(sessionLiveStatus(herdrBlocked)).toBe("blocked")
  })

  it("falls back to the placement when a Rex flavor is not a status word", () => {
    expect(sessionLiveStatus(rexBlocked)).toBe("live")
    expect(rexBlocked.status).toBe("com.superlogical.terminal.shell")
  })

  it("says unknown rather than inventing a state", () => {
    expect(sessionLiveStatus({ ...herdrLive, status: "???", state: "???" })).toBe("unknown")
  })
})
