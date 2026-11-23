import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { Option } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/*
 * Tailscale tells us which machines exist, not which sessions run on them. That is the
 * address book for pulling another shop's presence; it is not presence itself.
 */

const Node = Schema.Struct({
  HostName: Schema.String,
  DNSName: Schema.optional(Schema.String),
  Online: Schema.Boolean,
  OS: Schema.optional(Schema.String),
  TailscaleIPs: Schema.optional(Schema.Array(Schema.String)),
})

const Status = Schema.Struct({
  BackendState: Schema.String,
  Self: Node,
  Peer: Schema.optional(Schema.Record(Schema.String, Node)),
})

export interface TailnetPeer {
  readonly host: string
  readonly dnsName: string | undefined
  readonly online: boolean
  readonly os: string | undefined
  readonly ips: ReadonlyArray<string>
}

export interface Tailnet {
  readonly available: boolean
  readonly state: string | undefined
  readonly self: TailnetPeer | undefined
  readonly peers: ReadonlyArray<TailnetPeer>
}

type Run = (input: {
  readonly command: string
  readonly args: ReadonlyArray<string>
}) => Promise<string>

const run: Run = async ({ command, args }) => {
  const result = await promisify(execFile)(command, [...args], {
    timeout: 2_000,
    maxBuffer: 2_000_000,
  })
  return result.stdout
}

/** TAILSCALE_BIN first, then PATH, then the app bundle's CLI. */
const tailscaleBin = (exists: (path: string) => boolean): Option.Option<string> => {
  if (process.env.TAILSCALE_BIN !== undefined && process.env.TAILSCALE_BIN !== "")
    return Option.some(process.env.TAILSCALE_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "tailscale")
    if (exists(candidate)) return Option.some(candidate)
  }
  const app = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  return exists(app) ? Option.some(app) : Option.none()
}

const peerOf = (node: typeof Node.Type): TailnetPeer => ({
  host: node.HostName,
  dnsName: node.DNSName,
  online: node.Online,
  os: node.OS,
  ips: node.TailscaleIPs ?? [],
})

/** Parse one tailscale status --json document. */
const asOption = <A, E>(result: Result.Result<A, E>): Option.Option<A> =>
  Option.fromIterable(Result.isSuccess(result) ? [result.success] : [])

const parseTailnet = (text: string): Option.Option<Tailnet> =>
  Option.flatMap(
    asOption(Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)),
    (value) =>
      Option.map(asOption(Schema.decodeUnknownResult(Status)(value)), (status) => ({
        available: true,
        state: status.BackendState,
        self: peerOf(status.Self),
        peers: Object.values(status.Peer ?? {}).map(peerOf),
      })),
  )

/** Read the local tailnet view; absent daemon is unavailable, not an empty tailnet. */
export const discoverTailnet = async (deps?: {
  readonly run?: Run
  readonly exists?: (path: string) => boolean
}): Promise<Tailnet> => {
  const binary = tailscaleBin(deps?.exists ?? existsSync)
  if (Option.isNone(binary))
    return { available: false, state: undefined, self: undefined, peers: [] }
  const output = await (deps?.run ?? run)({
    command: binary.value,
    args: ["status", "--json"],
  }).catch(() => undefined)
  if (output === undefined) return { available: true, state: undefined, self: undefined, peers: [] }
  const parsed = parseTailnet(output)
  return Option.isSome(parsed)
    ? parsed.value
    : { available: true, state: undefined, self: undefined, peers: [] }
}
