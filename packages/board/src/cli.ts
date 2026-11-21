import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { listRooms } from "@autotelic/room/store"
import { readRun, startRoomRun } from "@autotelic/room/run"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const usage = [
  "board — the shop: supervisor, queue and one-owner lock",
  "",
  "Usage:",
  "  board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]",
  "  board down [--root .room]",
  "  board status [--root .room] [--json]   (rooms, lock, and the service)",
  "  board queue [--root .room] [--json]",
  "",
  "board up serves /health, /presence and /queue while it holds the lock.",
  "Exit codes: 0 ok, 1 declined, 2 usage, 3 infrastructure.",
].join("\n")

const EXIT = { clean: 0, declined: 1, usage: 2, infrastructure: 3 } as const

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

const alive = (pid: number): boolean => {
  // SAFETY: signalling a PID is a process boundary; ESRCH is the expected absence.
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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

const json = ({
  response,
  status,
  body,
}: {
  readonly response: import("node:http").ServerResponse
  readonly status: number
  readonly body: Schema.Json
}): void => {
  const text = JSON.stringify(body) + "\n"
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
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
  const rooms = await listRooms(root)
  return {
    shop: root,
    observedAt: new Date().toISOString(),
    service: { pid: process.pid, host, port },
    rooms: await Promise.all(
      rooms.map(async (room) => {
        const run = await readRun({ root, id: room.id })
        return {
          id: room.id,
          state: room.state._tag,
          process:
            run === undefined ? null : { pid: run.pid, alive: alive(run.pid), exec: run.exec },
        }
      }),
    ),
  }
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
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://" + host).pathname
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
    if (path === "/presence") {
      void presence({ root, port, host }).then(
        (body) => json({ response, status: 200, body }),
        (cause: unknown) => json({ response, status: 500, body: { error: String(cause) } }),
      )
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
      body: { error: "not found", paths: ["/health", "/presence", "/queue"] },
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })

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
      const exec = room.exec ?? run?.exec
      if (!wanted || exec === undefined) continue
      const started = await startRoomRun({
        root,
        id: room.id,
        worktree: join(root, room.id, "worktree"),
        exec,
        log: run?.log ?? join(root, room.id, "room.log"),
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

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }
  const parsed = parseArgs({ args: process.argv.slice(3), options, allowPositionals: false })
  const values = parsed.values
  if (values.help === true) {
    console.log(usage)
    return
  }
  const root = values.root

  if (command === "status") {
    const rooms = await listRooms(root)
    const shop = await readShop(root)
    if (values.json) {
      console.log(JSON.stringify({ shop, rooms }, null, 2))
      return
    }
    for (const room of rooms) console.log(room.id + " " + room.state._tag)
    console.log(describeShop(shop))
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
