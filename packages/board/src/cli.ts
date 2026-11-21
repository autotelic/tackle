import { parseArgs } from "node:util"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { listRooms } from "@autotelic/room/store"

const usage = [
  "board — the shop: supervisor, queue and one-owner lock",
  "",
  "Usage:",
  "  board status [--root .room] [--json]",
  "  board queue [--root .room] [--json]",
  "  board up [--root .room]",
  "  board down [--root .room]",
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
  const lock = join(root, "shop.lock")

  if (command === "status") {
    const rooms = await listRooms(root)
    if (values.json) console.log(JSON.stringify(rooms, null, 2))
    else console.log(rooms.map((room) => room.id + " " + room.state._tag).join("\n"))
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
    await mkdir(root, { recursive: true })
    const existing = await readFile(lock, "utf8").catch(() => undefined)
    if (existing !== undefined) {
      const owner = Number(JSON.parse(existing).pid)
      if (Number.isFinite(owner) && alive(owner)) return fail("ShopBusy", EXIT.declined)
    }
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() }, null, 2) + "\n")
    console.log("board: shop lock held by " + process.pid)
    return
  }

  if (command === "down") {
    const existing = await readFile(lock, "utf8").catch(() => undefined)
    if (existing !== undefined) {
      const owner = Number(JSON.parse(existing).pid)
      if (Number.isFinite(owner) && owner !== process.pid && alive(owner))
        return fail("ShopBusy", EXIT.declined)
    }
    await rm(lock, { force: true })
    console.log("board: shop lock released")
    return
  }

  return fail("unknown command " + command + " (see board --help)", EXIT.usage)
}

main().catch((cause) => fail(String(cause), EXIT.infrastructure))
