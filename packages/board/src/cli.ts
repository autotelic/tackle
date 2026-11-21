import { parseArgs } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { listRooms } from "@autotelic/room/store"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const usage = [
  "board — the shop: supervisor, queue and one-owner lock",
  "",
  "Usage:",
  "  board status [--root .room] [--json]   (rooms and the shop lock)",
  "  board queue [--root .room] [--json]",
  "  board up [--root .room]                (refuses until a supervisor exists)",
  "  board down [--root .room]              (refuses until a supervisor exists)",
  "",
  "Exit codes: 0 ok, 1 declined, 2 usage, 3 infrastructure.",
].join("\n")

const EXIT = { clean: 0, declined: 1, usage: 2, infrastructure: 3 } as const

const fail = (message: string, code: number): never => {
  console.error("board: " + message)
  process.exit(code)
}

const options = {
  root: { type: "string", default: ".room" },
  json: { type: "boolean", default: false },
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
      readonly alive: boolean
    }
  | { readonly state: "malformed" }

/**
 * The lock as `status` sees it. A lock that does not parse is malformed, not absent:
 * reporting "no lock" for a corrupt one is the same quiet zero the status line exists
 * to prevent.
 */
const ShopLock = Schema.Struct({ pid: Schema.Finite, at: Schema.optional(Schema.Finite) })

const readShop = async (root: string): Promise<Shop> => {
  const text = await readFile(join(root, "shop.lock"), "utf8").catch(() => undefined)
  if (text === undefined) return { state: "none" }
  const decoded = Schema.decodeResult(Schema.fromJsonString(ShopLock))(text)
  if (Result.isFailure(decoded)) return { state: "malformed" }
  const { pid, at } = decoded.success
  return { state: "held", pid, since: at, alive: alive(pid) }
}

const describeShop = (shop: Shop): string => {
  switch (shop.state) {
    case "none":
      return "shop: no lock"
    case "malformed":
      return "shop: lock unreadable"
    case "held":
      return shop.alive ? "shop: lock held by " + shop.pid : "shop: stale lock from " + shop.pid
  }
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

  if (command === "up" || command === "down")
    return fail(
      "not a supervisor yet; refusing to " +
        (command === "up" ? "hold" : "release") +
        " a lock it cannot keep",
      EXIT.declined,
    )

  return fail("unknown command " + command + " (see board --help)", EXIT.usage)
}

main().catch((cause) => fail(String(cause), EXIT.infrastructure))
