import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { UnknownRecord } from "./schema.ts"
import type { Tailnet, TailnetPeer } from "./tailnet.ts"

/*
 * Fleet is a pull: the tailnet says which machines exist, and each shop answers with the
 * presence document it already serves. A host that does not answer is recorded as an error,
 * not omitted: "unreachable" and "no rooms" are different states.
 */

const RemoteRoom = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  process: Schema.Unknown,
})

const RemoteSource = Schema.Struct({
  available: Schema.Boolean,
  sessions: Schema.Array(UnknownRecord),
})

const RemotePresence = Schema.Struct({
  shop: Schema.String,
  observedAt: Schema.String,
  authority: Schema.optional(Schema.String),
  rooms: Schema.Array(RemoteRoom),
  sessions: Schema.Struct({ herdr: RemoteSource, rex: RemoteSource }),
  network: Schema.optional(
    Schema.Struct({
      tailscale: Schema.optional(
        Schema.Struct({
          self: Schema.optional(Schema.Struct({ dnsName: Schema.optional(Schema.String) })),
        }),
      ),
    }),
  ),
})

export interface FleetRoom {
  readonly host: string
  readonly id: string
  readonly state: string
  readonly process: unknown
}

export interface FleetSession {
  readonly host: string
  readonly source: unknown
  readonly address: unknown
  readonly roomId: unknown
  readonly joinedBy: unknown
}

export interface FleetHost {
  readonly host: string
  readonly dnsName: string | undefined
  readonly online: boolean
  readonly self: boolean
  readonly url: string | undefined
  readonly ok: boolean
  readonly rooms: number | undefined
  readonly sessions: number | undefined
  readonly error: string | undefined
}

export interface Fleet {
  readonly observedAt: string
  readonly hosts: ReadonlyArray<FleetHost>
  readonly rooms: ReadonlyArray<FleetRoom>
  readonly sessions: ReadonlyArray<FleetSession>
}

type Fetcher = (url: string) => Promise<unknown>

const fetchJson: Fetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
  if (!response.ok) throw new Error("HTTP " + response.status)
  return await response.json()
}

const decode = (value: unknown): typeof RemotePresence.Type | undefined => {
  const decoded = Schema.decodeUnknownResult(RemotePresence)(value)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

const addressOf = (peer: TailnetPeer): string | undefined => {
  const dns = peer.dnsName?.replace(/\.$/u, "")
  if (dns !== undefined && dns !== "") return dns
  const ip = peer.ips[0]
  if (ip === undefined) return undefined
  return ip.includes(":") ? "[" + ip + "]" : ip
}

/** Try the discovery alias first, then the older route. */
const pull = async (input: {
  readonly base: string
  readonly fetcher: Fetcher
}): Promise<unknown> => {
  const paths = ["/.well-known/presence.json", "/presence"]
  let last: unknown = undefined
  for (const path of paths) {
    try {
      return await input.fetcher(input.base + path)
    } catch (cause) {
      last = cause
    }
  }
  throw last
}

/**
 * Pull every online peer's presence and merge rooms and sessions under a host label.
 *
 * @param input - the tailnet view, the local presence, the remote port, and the fetcher.
 * @returns one document; offline or unreachable hosts stay in it with their reason.
 */
export const fleet = async (input: {
  readonly tailnet: Tailnet
  readonly self: unknown
  readonly port: number
  readonly fetcher?: Fetcher
}): Promise<Fleet> => {
  const fetcher = input.fetcher ?? fetchJson
  const self = decode(input.self)
  const hosts: Array<FleetHost> = []
  const rooms: Array<FleetRoom> = []
  const sessions: Array<FleetSession> = []

  if (input.tailnet.self !== undefined) {
    hosts.push({
      host: input.tailnet.self.host,
      dnsName: input.tailnet.self.dnsName,
      online: input.tailnet.self.online,
      self: true,
      url: undefined,
      ok: self !== undefined,
      rooms: self?.rooms.length,
      sessions:
        self === undefined
          ? undefined
          : self.sessions.herdr.sessions.length + self.sessions.rex.sessions.length,
      error: self === undefined ? "local presence did not decode" : undefined,
    })
    for (const room of self?.rooms ?? []) rooms.push({ host: input.tailnet.self.host, ...room })
    for (const session of self?.sessions.herdr.sessions ?? [])
      sessions.push({
        host: input.tailnet.self.host,
        source: session.source,
        address: session.address,
        roomId: session.roomId,
        joinedBy: session.joinedBy,
      })
    for (const session of self?.sessions.rex.sessions ?? [])
      sessions.push({
        host: input.tailnet.self.host,
        source: session.source,
        address: session.address,
        roomId: session.roomId,
        joinedBy: session.joinedBy,
      })
  }

  await Promise.all(
    input.tailnet.peers.map(async (peer) => {
      const address = addressOf(peer)
      const base = address === undefined ? undefined : "http://" + address + ":" + input.port
      if (!peer.online) {
        hosts.push({
          host: peer.host,
          dnsName: peer.dnsName,
          online: false,
          self: false,
          url: base,
          ok: false,
          rooms: undefined,
          sessions: undefined,
          error: "offline",
        })
        return
      }
      if (base === undefined) {
        hosts.push({
          host: peer.host,
          dnsName: peer.dnsName,
          online: true,
          self: false,
          url: undefined,
          ok: false,
          rooms: undefined,
          sessions: undefined,
          error: "no address",
        })
        return
      }
      try {
        const decoded = decode(await pull({ base, fetcher }))
        if (decoded === undefined) throw new Error("presence did not decode")
        const expected = peer.dnsName?.replace(/\.$/u, "")
        const claimed = decoded.network?.tailscale?.self?.dnsName?.replace(/\.$/u, "")
        if (expected === undefined) throw new Error("no tailnet name to bind")
        if (claimed !== expected)
          throw new Error("origin mismatch: claimed " + (claimed ?? "no origin"))
        hosts.push({
          host: peer.host,
          dnsName: peer.dnsName,
          online: true,
          self: false,
          url: base,
          ok: true,
          rooms: decoded.rooms.length,
          sessions: decoded.sessions.herdr.sessions.length + decoded.sessions.rex.sessions.length,
          error: undefined,
        })
        for (const room of decoded.rooms) rooms.push({ host: peer.host, ...room })
        for (const session of decoded.sessions.herdr.sessions)
          sessions.push({
            host: peer.host,
            source: session.source,
            address: session.address,
            roomId: session.roomId,
            joinedBy: session.joinedBy,
          })
        for (const session of decoded.sessions.rex.sessions)
          sessions.push({
            host: peer.host,
            source: session.source,
            address: session.address,
            roomId: session.roomId,
            joinedBy: session.joinedBy,
          })
      } catch (cause) {
        hosts.push({
          host: peer.host,
          dnsName: peer.dnsName,
          online: true,
          self: false,
          url: base,
          ok: false,
          rooms: undefined,
          sessions: undefined,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }),
  )

  const counts = new Map<string, number>()
  for (const host of hosts) counts.set(host.host, (counts.get(host.host) ?? 0) + 1)
  const duplicated = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([host]) => host),
  )
  for (let index = 0; index < hosts.length; index++) {
    const host = hosts[index]
    if (host !== undefined && duplicated.has(host.host))
      hosts[index] = {
        ...host,
        ok: false,
        rooms: undefined,
        sessions: undefined,
        error: "duplicate host",
      }
  }

  const rank = (host: FleetHost): number => (host.self ? 0 : host.ok ? 1 : host.online ? 3 : 2)
  hosts.sort((left, right) => rank(left) - rank(right) || left.host.localeCompare(right.host))
  const hostRank = (host: string): number => (host === input.tailnet.self?.host ? 0 : 1)
  rooms.sort(
    (left, right) =>
      hostRank(left.host) - hostRank(right.host) ||
      left.host.localeCompare(right.host) ||
      left.id.localeCompare(right.id),
  )
  sessions.sort(
    (left, right) =>
      hostRank(left.host) - hostRank(right.host) ||
      left.host.localeCompare(right.host) ||
      String(left.address).localeCompare(String(right.address)),
  )
  return {
    observedAt: self?.observedAt ?? new Date().toISOString(),
    hosts,
    rooms: rooms.filter((room) => !duplicated.has(room.host)),
    sessions: sessions.filter((session) => !duplicated.has(session.host)),
  }
}
