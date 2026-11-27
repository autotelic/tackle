import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  createServer,
  request as requestUpstream,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { existsSync } from "node:fs"
import { json } from "./http.ts"
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"
import { Option } from "effect"
import { alive } from "@autotelic/room/run"
import { listRooms, readRoom, roomDir, type RoomFile } from "@autotelic/room/store"
import {
  roomSessionEnv,
  roomSessionEnvironment,
  roomSessionPath,
  roomSessionState,
} from "@autotelic/room/RoomSession"
import { readRun, startRoomRun } from "@autotelic/room/run"
import { observeService } from "@autotelic/room/Service"
import { observeVmService, readVmStatus, vmHttp, vmSocketFile } from "@autotelic/room/VmSupervisor"
import { activityOf } from "./factory/activity.ts"
import { answerDesk, listDesk } from "./factory/desk.ts"
import { listReports } from "./factory/report.ts"
import { listWorkstreamIssues, listWorkstreams } from "./factory/store.ts"
import { factoryMain } from "./factory/cli.ts"
import {
  discoverSessions,
  findHerdrAppBinary,
  findHerdrBinary,
  findRexBinary,
  servesAddress,
  tagWorkstreams,
  type Session,
} from "./sessions.ts"
import { atlasOf } from "./atlas.ts"
import { loopbackHostFor } from "./bind.ts"
import {
  candidateEnvironmentsOf,
  environmentsOf,
  type RoomPortLease,
  type RoomServiceObservation,
} from "./environment.ts"
import { listCandidateEnvironments } from "./factory/candidate-environments.ts"
import { previewPrefix, previewRequestOf } from "./preview.ts"
import { workstreamsWithGates } from "./gate.ts"
import { discoverTailnet } from "./tailnet.ts"
import { fleet, type Fleet } from "./fleet.ts"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const usage = [
  "board — the shop: supervisor, queue and one-owner lock",
  "",
  "Usage:",
  "  board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]",
  "  board down [--root .room]",
  "  board presence [--root .room] [--json] (rooms, processes, sessions)",
  "  board fleet [--root .room] [--port 4780] [--json]",
  "  board status [--root .room] [--json]   (rooms, shop, workstreams)",
  "  board adopt --path <worktree> --project <linear> --label <label> [factory options]",
  "  board event --id <id> --kind <kind> [--payload <json>] [--at <iso>]",
  "  board daemon start|run|stop --worker <command> [--interval <ms>]",
  "  board run|watch|report|phase|cursor|budget|desk … (factory commands)",
  "  board queue [--root .room] [--json]",
  "",
  "board up serves /health, /presence, /fleet, /queue, /factory, /preview/<workstream>/ and /open",
  "while it holds the lock.",
  "Exit codes: 0 ok, 1 declined, 2 usage, 3 infrastructure.",
].join("\n")

/**
 * The journal a room names, or null for a room created before the field existed.
 *
 * The state is read from the disk rather than from the record: a room file can name a journal on
 * a disk that was since cleared, and a reader asking whether the position is still there wants
 * the fact.
 */
const roomSessionOf = (root: string, room: RoomFile) => {
  if (room.session === undefined) return null
  const dir = roomDir({ root, id: room.id })
  return {
    path: roomSessionPath({ dir, session: room.session }),
    state: roomSessionState({ dir, session: room.session }),
  }
}

const EXIT = { clean: 0, declined: 1, usage: 2, infrastructure: 3 } as const

/** Remote text reaches a terminal; control characters never do. */
const safe = (value: string): string => value.replace(/\p{Cc}/gu, "?")

const fail = (message: string, code: number): never => {
  console.error("board: " + message)
  process.exit(code)
}

const options = {
  root: { type: "string", default: ".room" },
  host: { type: "string", default: "127.0.0.1" },
  port: { type: "string", default: "4780" },
  json: { type: "boolean", default: false },
  detach: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const

type Shop =
  | { readonly state: "none" }
  | {
      readonly state: "held"
      readonly pid: number
      readonly since: number | undefined
      readonly port: number | undefined
      readonly host: string | undefined
      readonly alive: boolean
    }
  | { readonly state: "malformed" }

const ShopLock = Schema.Struct({
  pid: Schema.Finite,
  at: Schema.optional(Schema.Finite),
  port: Schema.optional(Schema.Finite),
  host: Schema.optional(Schema.String),
})

const lockPath = (root: string): string => join(root, "shop.lock")

/**
 * The lock as `status` sees it. A lock that does not parse is malformed, not absent:
 * reporting "no lock" for a corrupt one is the same quiet zero the status line exists
 * to prevent.
 */
const readShop = async (root: string): Promise<Shop> => {
  const text = await readFile(lockPath(root), "utf8").catch(() => undefined)
  if (text === undefined) return { state: "none" }
  const decoded = Schema.decodeResult(Schema.fromJsonString(ShopLock))(text)
  if (Result.isFailure(decoded)) return { state: "malformed" }
  const { pid, at, port, host } = decoded.success
  return { state: "held", pid, since: at, port, host, alive: alive(pid) }
}

const describeShop = (shop: Shop): string => {
  switch (shop.state) {
    case "none":
      return "shop: no lock"
    case "malformed":
      return "shop: lock unreadable"
    case "held": {
      const where =
        shop.port === undefined ? "" : " on http://" + (shop.host ?? "127.0.0.1") + ":" + shop.port
      return shop.alive
        ? "shop: lock held by " + shop.pid + where
        : "shop: stale lock from " + shop.pid
    }
  }
}

type Claim = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** One owner per root: `wx` is the fence, and a stale lock is removed only after its pid is dead. */
const claim = async ({
  root,
  port,
  host,
}: {
  readonly root: string
  readonly port: number
  readonly host: string
}): Promise<Claim> => {
  await mkdir(root, { recursive: true })
  const record = JSON.stringify({ pid: process.pid, at: Date.now(), port, host })
  const write = () => writeFile(lockPath(root), record, { flag: "wx" })
  const first = await write().then(
    () => true,
    () => false,
  )
  if (first) return { ok: true }
  const existing = await readShop(root)
  if (existing.state === "held" && existing.alive)
    return { ok: false, message: "ShopBusy: " + existing.pid + " owns " + root }
  await rm(lockPath(root), { force: true })
  const second = await write().then(
    () => true,
    () => false,
  )
  return second ? { ok: true } : { ok: false, message: "ShopBusy: another board claimed " + root }
}

const observe = async (root: string) => {
  const rooms = await listRooms(root)
  const records = await listWorkstreams()
  const workstreamIssues = await listWorkstreamIssues()
  const sessions = await discoverSessions()
  const observedAt = new Date().toISOString()
  const now = Date.now()
  const activity = await Promise.all(records.map((record) => activityOf({ record, now })))
  const tailnet = await discoverTailnet()
  const tagged = {
    ...sessions,
    herdr: { ...sessions.herdr, sessions: tagWorkstreams(sessions.herdr.sessions, records) },
    rex: { ...sessions.rex, sessions: tagWorkstreams(sessions.rex.sessions, records) },
  }
  // A room's lease reaches the projection only through the worktree both records name. Both
  // sides go through realpath so a symlinked root cannot split one directory into two names.
  const canonical = new Map<string, string>()
  const canonicalOf = async (path: string): Promise<string> => {
    const resolved = await realpath(path).catch(() => resolve(path))
    canonical.set(path, resolved)
    return resolved
  }
  const roomFacts = await Promise.all(
    rooms.map(async (room) => ({
      room,
      run: await readRun({ root, id: room.id }),
      vm: await readVmStatus({ root, id: room.id }),
      worktree: await canonicalOf(join(root, room.id, "worktree")),
    })),
  )
  const leases: ReadonlyArray<RoomPortLease> = roomFacts.flatMap(({ room, worktree }) => {
    const port = room.port
    return port === undefined
      ? []
      : [
          {
            worktree,
            room: room.id,
            number: port.number,
            leasedAt: new Date(port.leasedAt).toISOString(),
          },
        ]
  })
  // A service is observed, not assumed: one probe per declaration, run together so a slow
  // service costs one timeout rather than one per room. A room that declares nothing
  // contributes no element, so the field stays empty instead of naming a service nobody saw.
  const services = (
    await Promise.all(
      roomFacts.map(async ({ room, run, worktree }) => {
        // A VM service has no host lease: its port lives inside the guest, and the board asks
        // the supervisor for the health path instead of probing a host port.
        if (room.runtime?.kind === "agentos") {
          const declared = room.service
          const port = room.runtime.previewPort
          if (declared === undefined || port === undefined) return undefined
          // The guest's own process table says whether the service is still there, and the
          // health path says whether it is well; the room makes both observations, so the
          // board serves them instead of deriving one from the other.
          const observed = await observeVmService({
            root,
            id: room.id,
            service: declared,
            port,
            pid: room.runtime.servicePid,
            checkedAt: observedAt,
          })
          return { worktree, ...observed }
        }
        const port = room.port
        if (room.service === undefined || port === undefined) return undefined
        const observed = await observeService({
          service: room.service,
          port: port.number,
          run,
          checkedAt: observedAt,
        })
        return { worktree, ...observed }
      }),
    )
  ).filter((service): service is RoomServiceObservation => service !== undefined)
  const vmPreviews = roomFacts.flatMap(({ room, worktree }) =>
    room.runtime?.kind === "agentos" && room.runtime.previewPort !== undefined
      ? [{ worktree, room: room.id, port: room.runtime.previewPort }]
      : [],
  )
  for (const record of records) await canonicalOf(record.path)
  const pathKey = (path: string): string => canonical.get(path) ?? resolve(path)
  return {
    shop: root,
    authority: "observation" as const,
    observedAt,
    sessions: tagged,
    network: { tailscale: tailnet },
    factory: {
      workstreamIssues,
      workstreams: await workstreamsWithGates({
        workstreams: records,
        activities: activity,
        observedAt,
      }),
      // Where each workstream runs, from the same tailnet read the document already carries.
      // The join is the tagging above, so this does not look for a session a second way.
      environments: environmentsOf({
        workstreams: records,
        sessions: [...tagged.herdr.sessions, ...tagged.rex.sessions],
        tailnet,
        leases,
        services,
        vmPreviews,
        pathKey,
        observedAt,
      }),
      // Candidate lanes are joined the same way and by the same facts: a candidate is a room, so
      // its lease and its service are its own and never the workstream's.
      candidates: candidateEnvironmentsOf({
        // A candidate record is global to the factory home; this presence is for one shop root.
        // Only the candidates whose room is in this root belong on this floor.
        candidates: (await listCandidateEnvironments()).filter((candidate) =>
          roomFacts.some(({ worktree }) => pathKey(worktree) === pathKey(candidate.path)),
        ),
        leases,
        services,
        vmPreviews,
        pathKey,
        observedAt,
      }),
      activity,
      desk: await listDesk(),
      reports: await listReports(),
    },
    rooms: roomFacts.map(({ room, run, vm }) => ({
      id: room.id,
      state: room.state._tag,
      runtime: room.runtime?.kind,
      // The room process and the VM supervisor are different processes with different jobs;
      // serving both lets the view say which one is actually running.
      process: run === undefined ? null : { pid: run.pid, alive: alive(run.pid), exec: run.exec },
      vm: { state: vm.state, ...(vm.run === undefined ? {} : { pid: vm.run.pid }) },
    })),
  }
}

/** The served document keeps the join result and drops the path evidence. */
const redact = (session: Session): Omit<Session, "cwd" | "labels"> => {
  const { cwd: _cwd, labels: _labels, ...rest } = session
  return rest
}

const withoutIps = <A extends { readonly ips: ReadonlyArray<string> }>(peer: A) => {
  const { ips: _ips, ...rest } = peer
  return rest
}

/**
 * One fleet read, reused for a few seconds, and never started twice at once.
 *
 * /presence may not carry peers: fleet asks every peer for its /presence, so a peer that asked
 * back would recurse. The floor therefore reads a separate document, and the two guards here
 * bound the fan-out — one round of peers per window, whatever the number of open pages.
 */
const FLEET_TTL_MS = 15_000
let fleetCache: { readonly at: number; readonly body: Fleet } | undefined
let fleetInFlight: Promise<Fleet> | undefined

const fleetOnce = async (input: {
  readonly root: string
  readonly port: number
}): Promise<Fleet> => {
  if (fleetCache !== undefined && Date.now() - fleetCache.at < FLEET_TTL_MS) return fleetCache.body
  const reading =
    fleetInFlight ??
    (async () => {
      const body = await fleet({
        tailnet: await discoverTailnet(),
        self: await observe(input.root),
        port: input.port,
      })
      fleetCache = { at: Date.now(), body }
      return body
    })().finally(() => {
      fleetInFlight = undefined
    })
  fleetInFlight = reading
  return reading
}

const presence = async ({
  root,
  port,
  host,
}: {
  readonly root: string
  readonly port: number
  readonly host: string
}) => {
  const snapshot = await observe(root)
  return {
    ...snapshot,
    network: {
      tailscale: {
        ...snapshot.network.tailscale,
        self:
          snapshot.network.tailscale.self === undefined
            ? undefined
            : withoutIps(snapshot.network.tailscale.self),
        peers: snapshot.network.tailscale.peers.map(withoutIps),
      },
    },
    sessions: {
      ...snapshot.sessions,
      herdr: {
        ...snapshot.sessions.herdr,
        sessions: snapshot.sessions.herdr.sessions.map(redact),
      },
    },
    service: { pid: process.pid, host, port },
  }
}

const viewDir = join(dirname(fileURLToPath(import.meta.url)), "..", "view", "dist")
const execFileAsync = promisify(execFile)
const SessionAddress = Schema.String.check(
  Schema.makeFilter((value) => /^[A-Za-z0-9:._-]+$/.test(value), {
    message: "invalid session address",
  }),
)
const OpenRequest = Schema.Struct({
  source: Schema.Union([Schema.Literal("herdr"), Schema.Literal("rex")]),
  address: SessionAddress,
})
const DeskAnswerRequest = Schema.Struct({
  item: Schema.String,
  choice: Schema.String,
  by: Schema.optional(Schema.String),
})

/** A room the board creates through the room tool's own boundary. */
const RoomCreateRequest = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  scope: Schema.String,
  base: Schema.optional(Schema.String),
  software: Schema.optional(Schema.String),
})

type RoomAction = "up" | "start" | "pause" | "resume" | "down"

/** The board's own listener is the only caller allowed to mutate rooms. */
const isLoopbackAddress = (address: string | undefined): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"

/** Run one room command through the room package's bin, never by reimplementing its store. */
const runRoom = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}): Promise<{ readonly stdout: string; readonly stderr: string }> => {
  const root = resolve(input.root)
  // Resolve the room CLI through the package export, not the installed bin: the bin runs dist,
  // and a workspace checkout can have source without a build. This runs the same condition the
  // board process is running under (source in development, dist in a package).
  const roomCli = fileURLToPath(import.meta.resolve("@autotelic/room/cli"))
  const conditions = roomCli.endsWith(".ts") ? ["--conditions=development"] : []
  // An absolute root is what keeps the room command from resolving `--root` against its own cwd.
  const result = await execFileAsync(
    process.execPath,
    [...conditions, roomCli, ...input.args, "--root", root],
    { cwd: dirname(root), timeout: 120_000 },
  )
  return { stdout: result.stdout, stderr: result.stderr }
}

const shellQuote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

/** Open an existing session in its owning app; addresses are never shell fragments. */
const openSession = async ({
  source,
  address,
}: {
  readonly source: string
  readonly address: string
}): Promise<"rex" | "herdr-app" | "herdr-terminal"> => {
  // An address from a POST is a claim, not a fact: only one discovery serves now is opened.
  // Without this, `hc attach <post body>` is an allowlisted command taking a request
  // parameter -- the argv hazard VISION.md names as the reason not to POST a command at all.
  if (source !== "herdr" && source !== "rex") {
    // oxlint-disable-next-line plumb/no-builtin-throws -- this HTTP boundary turns it into a 400
    throw new Error("unknown session source")
  }
  const discovery = await discoverSessions()
  if (!servesAddress({ discovery, source, address })) {
    // oxlint-disable-next-line plumb/no-builtin-throws -- this HTTP boundary turns it into a 400
    throw new Error("no live " + source + " session at " + address)
  }
  if (source === "rex") {
    const binary = findRexBinary()
    // oxlint-disable-next-line plumb/no-builtin-throws -- this HTTP boundary turns it into a 400
    if (Option.isNone(binary)) throw new Error("Rex is not installed")
    await execFileAsync(binary.value, ["block", "focus", address], { timeout: 5_000 })
    return "rex"
  }
  if (source === "herdr") {
    const app = findHerdrAppBinary()
    if (Option.isSome(app)) {
      const focus = () =>
        execFileAsync(app.value, ["do", "agent.focus", "--terminal", address], { timeout: 5_000 })
      const focused = await focus().then(
        () => true,
        () => false,
      )
      if (focused) return "herdr-app"
      await execFileAsync("/usr/bin/open", ["-a", "Herdr"], { timeout: 5_000 }).catch(
        () => undefined,
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      const retried = await focus().then(
        () => true,
        () => false,
      )
      if (retried) return "herdr-app"
    }
    const binary = findHerdrBinary()
    // oxlint-disable-next-line plumb/no-builtin-throws -- this HTTP boundary turns it into a 400
    if (Option.isNone(binary)) throw new Error("hc is not installed")
    const directory = join(homedir(), ".factory", "open")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => undefined)
    const script = join(directory, `attach-${randomUUID()}.command`)
    await writeFile(
      script,
      `#!/bin/sh\nexec ${shellQuote(binary.value)} attach ${shellQuote(address)}\n`,
      { mode: 0o700 },
    )
    await execFileAsync("/usr/bin/open", ["-a", "Terminal", script], { timeout: 5_000 })
    setTimeout(() => void rm(script, { force: true }), 60_000).unref()
    return "herdr-terminal"
  }
  // oxlint-disable-next-line plumb/no-builtin-throws -- this HTTP boundary turns it into a 400
  throw new Error("unknown session source")
}

const serveView = async ({
  response,
  path,
}: {
  readonly response: import("node:http").ServerResponse
  readonly path: string
}): Promise<void> => {
  const relative =
    path === "/" ||
    path === "/factory" ||
    path === "/tackle" ||
    path === "/tackle/" ||
    path === "/vision" ||
    path === "/vision/"
      ? "index.html"
      : path.slice("/factory/".length)
  if (relative.includes("..")) {
    json({ response, status: 404, body: { error: "not found" } })
    return
  }
  const file = await readFile(join(viewDir, relative)).catch(() => undefined)
  if (file === undefined) {
    json({ response, status: 404, body: { error: "factory view is not built" } })
    return
  }
  const type = relative.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : relative.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8"
  response.writeHead(200, { "content-type": type, "content-length": file.length })
  response.end(file)
}

/**
 * The port a workstream's preview forwards to.
 *
 * Resolved at request time from the same two facts `observe` joins on: the workstream's path and
 * the room whose worktree is that directory. The room must declare a service and hold the lease —
 * a workstream no room holds has no route, so the board refuses instead of forwarding to a
 * number some other room owns.
 *
 * @param input - the shop root and the workstream's recorded checkout.
 * @returns the leased port, or undefined when no room with a service owns this worktree.
 */
type PreviewTarget =
  | { readonly kind: "host"; readonly port: number }
  | { readonly kind: "vm"; readonly room: string; readonly port: number }

const previewPortOf = async (input: {
  readonly root: string
  readonly path: string
}): Promise<PreviewTarget | undefined> => {
  const wanted = await realpath(input.path).catch(() => resolve(input.path))
  for (const room of await listRooms(input.root)) {
    const worktree = join(input.root, room.id, "worktree")
    const candidate = await realpath(worktree).catch(() => resolve(worktree))
    if (candidate !== wanted) continue
    // A VM service has no host lease: its port lives inside the guest, and the board asks the
    // room supervisor for the answer. A local room keeps forwarding to its leased host port.
    if (room.runtime?.kind === "agentos" && room.runtime.previewPort !== undefined)
      return { kind: "vm", room: room.id, port: room.runtime.previewPort }
    if (room.service !== undefined && room.port !== undefined)
      return { kind: "host", port: room.port.number }
  }
  return undefined
}

/** Headers a proxy never forwards: they describe one connection, not the request. */
const hopByHopHeaders = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

/**
 * Forward one GET to the service the workstream's room leases.
 *
 * The route is a path on the board, so the board is the only thing that resolves it: a reader
 * that kept an old preview URL reaches whatever lease the room holds now, and a workstream with
 * no service gets 404 rather than a neighbour's port. The answer streams through untouched —
 * the service owns its bytes, status and content type. A refused port is 502, not an empty 200.
 */
const servePreview = async ({
  root,
  request,
  response,
}: {
  readonly root: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
}): Promise<void> => {
  const preview = previewRequestOf(request.url ?? "/")
  if (Option.isNone(preview)) {
    json({ response, status: 404, body: { error: "not found" } })
    return
  }
  // Compared in the encoded form `previewRoute` writes, so an id with a space or a slash needs
  // no decoding here and a malformed escape names nothing.
  const record = (await listWorkstreams()).find(
    (entry) => encodeURIComponent(entry.id) === preview.value.segment,
  )
  // A candidate's route is its own id, and it must resolve or a candidate would serve a preview
  // link the board cannot answer. A dropped lane keeps its record but stops answering.
  const lane =
    record === undefined
      ? (await listCandidateEnvironments()).find(
          (entry) =>
            entry.state !== "dropped" && encodeURIComponent(entry.id) === preview.value.segment,
        )
      : undefined
  const served = record ?? lane
  if (served === undefined) {
    json({ response, status: 404, body: { error: "no workstream " + preview.value.segment } })
    return
  }
  const target = await previewPortOf({ root, path: served.path })
  if (target === undefined) {
    json({ response, status: 404, body: { error: "no service is leased for " + served.id } })
    return
  }
  if (target.kind === "vm") {
    const answer = await vmHttp({
      socket: vmSocketFile({ root, id: target.room }),
      request: {
        kind: "http",
        port: target.port,
        path: preview.value.path,
        method: "GET",
      },
    }).catch(() => undefined)
    if (answer === undefined || answer.kind === "error" || answer.kind !== "http") {
      json({ response, status: 502, body: { error: "preview did not answer" } })
      return
    }
    const body = Buffer.from(answer.body, "base64")
    response.writeHead(answer.status, {
      ...answer.headers,
      "content-length": String(body.length),
    })
    response.end(body)
    return
  }
  const upstream = requestUpstream(
    {
      host: "127.0.0.1",
      port: target.port,
      path: preview.value.path,
      method: "GET",
      // One connection per preview request, closed with the answer: no pool outlives the page.
      agent: false,
      headers: Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name, value]) => value !== undefined && !hopByHopHeaders.has(name.toLowerCase()),
        ),
      ),
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(response)
    },
  )
  // SAFETY: a refused or reset connection is the observation this route exists to report; it
  // becomes a 502 unless the answer already began, in which case the stream is truncated.
  upstream.on("error", () => {
    if (response.headersSent) response.destroy()
    else json({ response, status: 502, body: { error: "preview did not answer" } })
  })
  response.once("close", () => upstream.destroy())
  upstream.end()
}

const serve = async ({
  root,
  host,
  port,
}: {
  readonly root: string
  readonly host: string
  readonly port: number
}): Promise<void> => {
  // One handler, up to two listeners: the address the operator asked for, and loopback so the
  // tools on this machine can read the shop (the factory panel reads /presence there).
  const handle: import("node:http").RequestListener = (request, response) => {
    // Only the path matters, and a hostname here would have to survive IPv6 brackets.
    const path = new URL(request.url ?? "/", "http://board.invalid").pathname
    if (path === "/open" && request.method === "POST") {
      void (async () => {
        // oxlint-disable-next-line plumb-effect/no-try-catch -- the HTTP handler consumes JSON.parse and child-process failures here
        try {
          let body = ""
          for await (const chunk of request) {
            body += String(chunk)
            if (body.length > 4_096) {
              json({ response, status: 400, body: { error: "request body is too large" } })
              return
            }
          }
          const decoded = Schema.decodeResult(Schema.fromJsonString(OpenRequest))(body)
          if (Result.isFailure(decoded)) {
            json({ response, status: 400, body: { error: "expected {source, address}" } })
            return
          }
          const rung = await openSession(decoded.success)
          json({ response, status: 200, body: { ok: true, rung } })
        } catch (cause: unknown) {
          json({ response, status: 400, body: { error: String(cause) } })
        }
      })()
      return
    }
    if (path === "/rooms" && request.method === "POST") {
      void (async () => {
        // oxlint-disable-next-line plumb-effect/no-try-catch -- the HTTP handler consumes JSON.parse and child-process failures here
        try {
          if (!isLoopbackAddress(request.socket.remoteAddress)) {
            json({ response, status: 403, body: { error: "room control is loopback only" } })
            return
          }
          let body = ""
          for await (const chunk of request) {
            body += String(chunk)
            if (body.length > 16_384) {
              json({ response, status: 400, body: { error: "request body is too large" } })
              return
            }
          }
          const decoded = Schema.decodeResult(Schema.fromJsonString(RoomCreateRequest))(body)
          if (Result.isFailure(decoded)) {
            json({ response, status: 400, body: { error: "expected {id, repo, scope}" } })
            return
          }
          const input = decoded.success
          const args = [
            "new",
            "--id",
            input.id,
            "--repo",
            input.repo,
            "--scope",
            input.scope,
            ...(input.base === undefined ? [] : ["--base", input.base]),
            ...(input.software === undefined ? [] : ["--software", input.software]),
          ]
          const result = await runRoom({ root, args })
          json({ response, status: 200, body: { ok: true, id: input.id, ...result } })
        } catch (cause: unknown) {
          json({ response, status: 500, body: { error: String(cause) } })
        }
      })()
      return
    }
    if (path === "/rooms" && request.method === "GET") {
      void (async () => {
        // oxlint-disable-next-line plumb-effect/no-try-catch -- the HTTP handler consumes room/store failures here
        try {
          const rooms = await listRooms(root)
          json({
            response,
            status: 200,
            body: {
              rooms: await Promise.all(
                rooms.map(async (room) => {
                  const vm = await readVmStatus({ root, id: room.id })
                  return {
                    id: room.id,
                    state: room.state._tag,
                    runtime: room.runtime?.kind,
                    port: room.port?.number,
                    session: roomSessionOf(root, room),
                    socket: vmSocketFile({ root, id: room.id }),
                    vm: { state: vm.state, ...(vm.run === undefined ? {} : { pid: vm.run.pid }) },
                  }
                }),
              ),
            },
          })
        } catch (cause: unknown) {
          json({ response, status: 500, body: { error: String(cause) } })
        }
      })()
      return
    }
    const roomAction = /^\/rooms\/([^/]+)\/(up|start|pause|resume|down)$/u.exec(path)
    if (roomAction !== null && request.method === "POST") {
      void (async () => {
        // oxlint-disable-next-line plumb-effect/no-try-catch -- the HTTP handler consumes child-process failures here
        try {
          if (!isLoopbackAddress(request.socket.remoteAddress)) {
            json({ response, status: 403, body: { error: "room control is loopback only" } })
            return
          }
          const id = decodeURIComponent(roomAction[1] ?? "")
          const action = roomAction[2] as RoomAction
          // `up` starts the room's declared service; `start` starts its VM. They are different
          // machines of work, so the control plane keeps both verbs instead of guessing.
          const args = action === "start" ? ["vm", "start", "--id", id] : [action, "--id", id]
          const result = await runRoom({ root, args })
          // The lifecycle's answer carries the journal's path and whether its bytes are there,
          // read after the command ran: the caller learns where the room's position lives
          // without a second request.
          const room = await readRoom({ root, id })
          json({
            response,
            status: 200,
            body: {
              ok: true,
              id,
              action,
              session: room === undefined ? null : roomSessionOf(root, room),
              ...result,
            },
          })
        } catch (cause: unknown) {
          json({ response, status: 500, body: { error: String(cause) } })
        }
      })()
      return
    }
    if (path === "/desk/answer" && request.method === "POST") {
      void (async () => {
        // oxlint-disable-next-line plumb-effect/no-try-catch -- the HTTP handler consumes JSON.parse and desk errors here
        try {
          let body = ""
          for await (const chunk of request) {
            body += String(chunk)
            if (body.length > 4_096) {
              json({ response, status: 400, body: { error: "request body is too large" } })
              return
            }
          }
          const decoded = Schema.decodeResult(Schema.fromJsonString(DeskAnswerRequest))(body)
          if (Result.isFailure(decoded)) {
            json({ response, status: 400, body: { error: "expected {item, choice}" } })
            return
          }
          await answerDesk({
            answer: {
              item: decoded.success.item,
              choice: decoded.success.choice,
              by: decoded.success.by ?? "web",
              at: new Date().toISOString(),
            },
          })
          json({ response, status: 200, body: { ok: true } })
        } catch (cause: unknown) {
          json({ response, status: 400, body: { error: String(cause) } })
        }
      })()
      return
    }
    if (request.method !== "GET") {
      json({ response, status: 405, body: { error: "method not allowed" } })
      return
    }
    if (path === "/health") {
      json({
        response,
        status: 200,
        body: { ok: true, shop: root, pid: process.pid, since: startedAt },
      })
      return
    }
    if (path === "/presence" || path === "/.well-known/presence.json") {
      void presence({ root, port, host }).then(
        (body) => json({ response, status: 200, body }),
        (cause: unknown) => json({ response, status: 500, body: { error: String(cause) } }),
      )
      return
    }
    if (path === "/fleet") {
      void fleetOnce({ root, port }).then(
        (body) => json({ response, status: 200, body }),
        (cause: unknown) => json({ response, status: 500, body: { error: String(cause) } }),
      )
      return
    }
    if (path === "/atlas") {
      void atlasOf({ root, generatedAt: new Date().toISOString() }).then(
        (body) => json({ response, status: 200, body }),
        (cause: unknown) => json({ response, status: 500, body: { error: String(cause) } }),
      )
      return
    }
    if (path.startsWith(previewPrefix)) {
      void servePreview({ root, request, response })
      return
    }
    if (
      path === "/" ||
      path === "/factory" ||
      path === "/tackle" ||
      path === "/tackle/" ||
      path === "/vision" ||
      path === "/vision/" ||
      path.startsWith("/factory/")
    ) {
      void serveView({ response, path })
      return
    }
    if (path === "/queue") {
      void listRooms(root).then(
        (rooms) =>
          json({
            response,
            status: 200,
            body: rooms.filter((room) => room.state._tag === "Paused").map((room) => room.id),
          }),
        (cause: unknown) => json({ response, status: 500, body: { error: String(cause) } }),
      )
      return
    }
    json({
      response,
      status: 404,
      body: {
        error: "not found",
        paths: [
          "/",
          "/factory",
          "/tackle",
          "/vision",
          "/atlas",
          "/fleet",
          "/health",
          "/presence",
          "/.well-known/presence.json",
          "/queue",
          "/rooms",
          "/rooms/<id>/up|start|pause|resume|down",
          "/preview/<workstream>/",
          "/open",
          "/desk/answer",
        ],
      },
    })
  }

  const server = createServer(handle)
  const loopback = Option.getOrUndefined(loopbackHostFor(host))
  const also = loopback === undefined ? undefined : createServer(handle)
  // SAFETY: serve() owns both listeners and the shop lock; a bind failure has already closed
  // both servers and released the lock, and main() turns the rethrow into exit 3. A loopback bind
  // that fails means something else answers there, so the run fails rather than read another
  // shop.
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, host, resolve)
    })
    if (also !== undefined)
      await new Promise<void>((resolve, reject) => {
        also.once("error", reject)
        also.listen(port, loopback, resolve)
      })
  } catch (cause: unknown) {
    // Both listeners are gone and so is this run: an unbound port must not keep the shop locked.
    server.close()
    also?.close()
    await rm(lockPath(root), { force: true })
    // oxlint-disable-next-line plumb/no-builtin-throws -- main() turns the bind failure into exit 3
    throw cause
  }

  const startedAt = Date.now()
  console.log(
    "board: shop " +
      root +
      " listening on http://" +
      host +
      ":" +
      port +
      " (pid " +
      process.pid +
      ")",
  )
  if (also !== undefined)
    console.log(
      "board: also listening on http://" + loopback + ":" + port + " for this machine's tools",
    )
  console.log("board: press Ctrl-C, or run `board down --root " + root + "`")

  /** Restart a room supervisor that died while its room is not paused. */
  const watch = async (): Promise<void> => {
    for (const room of await listRooms(root)) {
      if (room.state._tag === "Paused") continue
      const run = await readRun({ root, id: room.id })
      if (run !== undefined && alive(run.pid)) continue
      // A room marked wanted is started even after its run record is gone; legacy records
      // without the flag are restarted only because a supervisor already existed.
      const wanted = room.desired ?? run !== undefined
      // A declared service owns the command; a room without one may still carry the plain
      // command an earlier `up` recorded.
      const exec = room.service?.command ?? room.exec ?? run?.exec
      if (!wanted || exec === undefined) continue
      // A missing worktree is not something the shop can repair; the room's own `up` is.
      if (!existsSync(join(root, room.id, "worktree"))) continue
      const started = await startRoomRun({
        root,
        id: room.id,
        worktree: join(root, room.id, "worktree"),
        exec,
        log: run?.log ?? join(root, room.id, "room.log"),
        port: room.port?.number,
        environment: roomSessionEnv(
          roomSessionEnvironment({ root, id: room.id, session: room.session }),
        ),
      })
      if (started.ok)
        console.log("board: restarted room " + room.id + " as supervisor " + started.run.pid)
      else console.error("board: could not restart " + room.id + " — " + started.reason)
    }
  }
  const timer = setInterval(() => {
    void watch()
  }, 5_000)
  void watch()

  const shutdown = (): void => {
    clearInterval(timer)
    server.close(() => {
      void rm(lockPath(root), { force: true }).finally(() => process.exit(EXIT.clean))
    })
    also?.close()
    setTimeout(() => process.exit(EXIT.clean), 2_000).unref()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

const detach = async ({
  root,
  host,
  port,
}: {
  readonly root: string
  readonly host: string
  readonly port: number
}): Promise<void> => {
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      process.argv[1] ?? "",
      "up",
      "--root",
      root,
      "--host",
      host,
      "--port",
      String(port),
    ],
    { detached: true, stdio: "ignore", env: { ...process.env, BOARD_CHILD: "1" } },
  )
  child.unref()
  for (let attempt = 0; attempt < 40; attempt++) {
    const shop = await readShop(root)
    if (shop.state === "held" && shop.alive && shop.pid === child.pid) {
      console.log(
        "board: shop " +
          root +
          " listening on http://" +
          host +
          ":" +
          port +
          " (pid " +
          child.pid +
          ")",
      )
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return fail("detached board did not claim the shop", EXIT.infrastructure)
}

const factoryCommands = new Set([
  "adopt",
  "event",
  "run",
  "watch",
  "report",
  "phase",
  "cursor",
  "budget",
  "daemon",
  "desk",
  "link",
  "worker",
  "guard",
])

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }
  // Factory commands take their own flags; delegate before board's parser sees them.
  if (command === "factory") {
    await factoryMain(process.argv.slice(3))
    return
  }
  if (factoryCommands.has(command)) {
    await factoryMain(process.argv.slice(2))
    return
  }
  const parsed = parseArgs({ args: process.argv.slice(3), options, allowPositionals: false })
  const values = parsed.values
  if (values.help === true) {
    console.log(usage)
    return
  }
  const root = values.root

  if (command === "presence") {
    const snapshot = await observe(root)
    if (values.json) {
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }
    for (const room of snapshot.rooms)
      console.log(
        room.id + " " + room.state + (room.process === null ? "" : " pid " + room.process.pid),
      )
    console.log(
      snapshot.sessions.herdr.available
        ? "herdr: " + snapshot.sessions.herdr.sessions.length + " sessions"
        : "herdr: unavailable",
    )
    console.log(snapshot.sessions.rex.available ? "rex: available" : "rex: unavailable")
    return
  }

  if (command === "fleet") {
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      return fail("--port must be an integer between 1 and 65535", EXIT.usage)
    const result = await fleet({
      tailnet: await discoverTailnet(),
      self: await observe(root),
      port,
    })
    if (values.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    for (const host of result.hosts)
      console.log(
        safe(host.host) +
          (host.self ? " (self)" : "") +
          ": " +
          (host.ok
            ? host.rooms +
              " rooms, " +
              (host.environments ?? 0) +
              " environments, " +
              host.sessions +
              " sessions"
            : safe(host.error ?? "unknown")),
      )
    console.log(result.rooms.length + " rooms, " + result.sessions.length + " sessions total")
    return
  }

  if (command === "status") {
    const rooms = await listRooms(root)
    const shop = await readShop(root)
    const workstreams = await listWorkstreams()
    if (values.json) {
      console.log(JSON.stringify({ shop, rooms, workstreams }, null, 2))
      return
    }
    for (const room of rooms) console.log(room.id + " " + room.state._tag)
    console.log(describeShop(shop))
    for (const record of workstreams)
      console.log(
        [
          record.id,
          record.project,
          record.delivery === "trunk" || record.pr === undefined
            ? "delivery trunk"
            : "PR " + record.pr,
          record.phase,
          "checkpoint " + record.checkpoint.sha.slice(0, 8),
        ].join("  "),
      )
    return
  }

  if (command === "queue") {
    const rooms = await listRooms(root)
    const paused = rooms.filter((room) => room.state._tag === "Paused")
    if (values.json) console.log(JSON.stringify(paused, null, 2))
    else console.log(paused.map((room) => room.id).join("\n"))
    return
  }

  if (command === "up") {
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      return fail("--port must be an integer between 1 and 65535", EXIT.usage)
    if (values.detach && process.env.BOARD_CHILD !== "1") {
      await detach({ root, host: values.host, port })
      return
    }
    const claimed = await claim({ root, port, host: values.host })
    if (!claimed.ok) return fail(claimed.message, EXIT.declined)
    await serve({ root, host: values.host, port })
    return
  }

  if (command === "down") {
    const shop = await readShop(root)
    if (shop.state === "none") return fail("no shop is running at " + root, EXIT.declined)
    if (shop.state === "malformed") return fail("the shop lock is unreadable", EXIT.infrastructure)
    if (!shop.alive) {
      await rm(lockPath(root), { force: true })
      console.log("board: removed a stale lock from " + shop.pid)
      return
    }
    process.kill(shop.pid, "SIGTERM")
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!alive(shop.pid)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (alive(shop.pid)) {
      process.kill(shop.pid, "SIGKILL")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await rm(lockPath(root), { force: true })
    console.log("board: stopped " + shop.pid)
    return
  }

  return fail("unknown command " + command + " (see board --help)", EXIT.usage)
}

main().catch((cause) => fail(String(cause), EXIT.infrastructure))
