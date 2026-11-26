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
  network: { tailscale: { self: { dnsName: "remote.tail.ts.net." } } },
  observedAt: "2026-11-21T00:00:01.000Z",
  rooms: [{ id: "remote-room", state: "Paused", process: null }],
  factory: {
    environments: [
      {
        workstream: "remote-ws",
        machine: { host: "remote" },
        runtime: { kind: "agentos", path: "/remote/ws" },
        vmPort: 4819,
        services: [{ name: "web", port: 4819, status: "healthy" }],
        preview: "/preview/remote-ws/",
      },
    ],
  },
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
        environments: undefined,
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
        environments: 1,
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
        environments: undefined,
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
        environments: undefined,
        error: "unreachable",
      },
    ])
    expect(result.rooms).toEqual([
      { host: "self", id: "local", state: "Ready", process: null },
      { host: "remote", id: "remote-room", state: "Paused", process: null },
    ])
    expect(result.environments).toEqual([
      {
        host: "remote",
        workstream: "remote-ws",
        machine: { host: "remote" },
        runtime: { kind: "agentos", path: "/remote/ws" },
        vmPort: 4819,
        services: [{ name: "web", port: 4819, status: "healthy" }],
        preview: "/preview/remote-ws/",
      },
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

  it("does not let two hosts with one label win silently", async () => {
    const firstPeer = tailnet.peers[0]!
    const result = await fleet({
      tailnet: {
        ...tailnet,
        peers: [firstPeer, { ...firstPeer, dnsName: "other.tail.ts.net.", ips: ["100.0.0.9"] }],
      },
      self: selfPresence,
      port: 4780,
      fetcher: async () => remotePresence,
    })
    expect(result.hosts.filter((host) => host.host === "remote")).toEqual([
      expect.objectContaining({ ok: false, error: "duplicate host", rooms: undefined }),
      expect.objectContaining({ ok: false, error: "duplicate host", rooms: undefined }),
    ])
    expect(result.rooms).toEqual([{ host: "self", id: "local", state: "Ready", process: null }])
    expect(result.environments).toEqual([])
    expect(result.sessions.map((session) => session.host)).toEqual(["self"])
  })
})
