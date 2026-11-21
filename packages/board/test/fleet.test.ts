import { describe, expect, it } from "vitest"
import { fleet } from "../src/fleet.ts"

/* oxlint-disable plumb/prefer-property-tests -- one fixed tailnet and three fixed hosts. */

const selfPresence = {
  shop: ".room",
  observedAt: "2026-11-21T00:00:00.000Z",
  rooms: [{ id: "local", state: "Ready", process: null }],
  sessions: {
    herdr: { available: true, sessions: [{ source: "herdr", address: "t1", roomId: "local" }] },
    rex: { available: true, sessions: [] },
  },
}

const remotePresence = {
  shop: "remote",
  observedAt: "2026-11-21T00:00:01.000Z",
  rooms: [{ id: "remote-room", state: "Paused", process: null }],
  sessions: {
    herdr: {
      available: true,
      sessions: [{ source: "herdr", address: "t2", roomId: "remote-room" }],
    },
    rex: { available: false, sessions: [] },
  },
}

const tailnet = {
  available: true,
  state: "Running",
  self: {
    host: "self",
    dnsName: "self.tail.ts.net.",
    online: true,
    os: "macOS",
    ips: ["100.0.0.1"],
  },
  peers: [
    {
      host: "remote",
      dnsName: "remote.tail.ts.net.",
      online: true,
      os: "macOS",
      ips: ["100.0.0.2"],
    },
    {
      host: "offline",
      dnsName: "offline.tail.ts.net.",
      online: false,
      os: "macOS",
      ips: ["100.0.0.3"],
    },
    {
      host: "broken",
      dnsName: "broken.tail.ts.net.",
      online: true,
      os: "macOS",
      ips: ["100.0.0.4"],
    },
  ],
}

describe("fleet pulls presence from the tailnet", () => {
  it("merges reachable hosts and records the rest", async () => {
    const result = await fleet({
      tailnet,
      self: selfPresence,
      port: 4780,
      fetcher: async (url) => {
        if (url.startsWith("http://remote.tail.ts.net")) return remotePresence
        throw new Error("unreachable")
      },
    })
    expect(result.hosts).toEqual([
      {
        host: "self",
        dnsName: "self.tail.ts.net.",
        online: true,
        self: true,
        url: undefined,
        ok: true,
        rooms: 1,
        sessions: 1,
        error: undefined,
      },
      {
        host: "remote",
        dnsName: "remote.tail.ts.net.",
        online: true,
        self: false,
        url: "http://remote.tail.ts.net:4780",
        ok: true,
        rooms: 1,
        sessions: 1,
        error: undefined,
      },
      {
        host: "offline",
        dnsName: "offline.tail.ts.net.",
        online: false,
        self: false,
        url: "http://offline.tail.ts.net:4780",
        ok: false,
        rooms: undefined,
        sessions: undefined,
        error: "offline",
      },
      {
        host: "broken",
        dnsName: "broken.tail.ts.net.",
        online: true,
        self: false,
        url: "http://broken.tail.ts.net:4780",
        ok: false,
        rooms: undefined,
        sessions: undefined,
        error: "unreachable",
      },
    ])
    expect(result.rooms).toEqual([
      { host: "self", id: "local", state: "Ready", process: null },
      { host: "remote", id: "remote-room", state: "Paused", process: null },
    ])
    expect(result.sessions).toEqual([
      { host: "self", source: "herdr", address: "t1", roomId: "local", joinedBy: undefined },
      {
        host: "remote",
        source: "herdr",
        address: "t2",
        roomId: "remote-room",
        joinedBy: undefined,
      },
    ])
  })
})
