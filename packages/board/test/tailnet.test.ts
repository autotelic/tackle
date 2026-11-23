import { describe, expect, it } from "vitest"
import { discoverTailnet } from "../src/tailnet.ts"

/* oxlint-disable plumb/prefer-property-tests -- one fixed status shape from Tailscale. */

const status = JSON.stringify({
  BackendState: "Running",
  Self: {
    HostName: "MacBook Pro",
    DNSName: "macbook-pro.tail.ts.net.",
    Online: true,
    OS: "macOS",
    TailscaleIPs: ["100.1.1.1"],
  },
  Peer: {
    p1: { HostName: "phone", DNSName: "phone.tail.ts.net.", Online: true, OS: "iOS" },
    p2: { HostName: "old", Online: false },
  },
})

describe("the tailnet is an address book", () => {
  it("parses self and peers", async () => {
    expect(
      await discoverTailnet({
        exists: (path) => path.endsWith("/tailscale"),
        run: async () => status,
      }),
    ).toEqual({
      available: true,
      state: "Running",
      self: {
        host: "MacBook Pro",
        dnsName: "macbook-pro.tail.ts.net.",
        online: true,
        os: "macOS",
        ips: ["100.1.1.1"],
      },
      peers: [
        { host: "phone", dnsName: "phone.tail.ts.net.", online: true, os: "iOS", ips: [] },
        { host: "old", dnsName: undefined, online: false, os: undefined, ips: [] },
      ],
    })
  })

  it("reports unavailable without a binary", async () => {
    expect(await discoverTailnet({ exists: () => false })).toEqual({
      available: false,
      state: undefined,
      self: undefined,
      peers: [],
    })
  })

  it("reports available and empty when status fails", async () => {
    expect(
      await discoverTailnet({
        exists: (path) => path.endsWith("/tailscale"),
        run: async () => {
          throw new Error("daemon down")
        },
      }),
    ).toEqual({ available: true, state: undefined, self: undefined, peers: [] })
  })
})
