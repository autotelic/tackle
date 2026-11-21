import { Effect } from "effect"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import { Worktree, WorktreeLive } from "./Worktree.ts"
import {
  createRoom,
  listRooms,
  pauseRoom,
  readRoom,
  resumeRoom,
  roomDir,
  RoomDecodeError,
} from "./store.ts"
import { alive, readRun, removeRun, runFile, signalRun } from "./run.ts"

const usage = [
  "room — one durable place per scope",
  "",
  "Usage:",
  "  room new --repo <path> --scope <name> [--base main] [--id <id>] [--root .room]",
  "  room up --id <id> [--exec <command>] [--root .room]",
  "  room down --id <id> [--root .room]",
  "  room status [--id <id>] [--root .room] [--json]",
  "  room pause --id <id> [--root .room]",
  "  room resume --id <id> [--root .room]",
  "  room move --id <id> --to <host> [--root .room] [--json]  (not implemented; refuses)",
  "",
  "Exit codes: 0 ok, 1 declined, 2 usage, 3 infrastructure.",
].join("\n")

const EXIT = { clean: 0, declined: 1, usage: 2, infrastructure: 3 } as const

const fail = (message: string, code: number): never => {
  console.error("room: " + message)
  process.exit(code)
}

const options = {
  repo: { type: "string" },
  scope: { type: "string" },
  base: { type: "string", default: "main" },
  id: { type: "string" },
  root: { type: "string", default: ".room" },
  to: { type: "string" },
  json: { type: "boolean", default: false },
  exec: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const

const supervisor = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  return existsSync(join(here, "supervise.js"))
    ? join(here, "supervise.js")
    : join(here, "supervise.ts")
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "room"

const ensureWorktree = (input: {
  readonly repo: string
  readonly base: string
  readonly root: string
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const trees = yield* Worktree
      return yield* trees.ensure(input)
    }).pipe(Effect.provide(WorktreeLive)),
  )

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

  if (command === "new") {
    if (values.repo === undefined || values.scope === undefined)
      return fail("new needs --repo and --scope (see room --help)", EXIT.usage)
    const id = values.id ?? slug(values.scope + "-" + (values.repo.split("/").at(-1) ?? "repo"))
    let worktree = join(roomDir({ root, id }), "worktree")
    // SAFETY: the worktree provider is a process boundary; its failure is infrastructure.
    try {
      worktree = await ensureWorktree({ repo: values.repo, base: values.base, root: worktree })
    } catch (cause) {
      return fail("worktree failed: " + String(cause), EXIT.infrastructure)
    }
    const created = await createRoom({
      root,
      id,
      repo: values.repo,
      scope: values.scope,
      base: values.base,
      at: Date.now(),
    })
    if (!created.ok) return fail(created.error, EXIT.declined)
    console.log("room " + id + " ready at " + worktree)
    return
  }

  if (command === "status") {
    if (values.id !== undefined) {
      const room = await readRoom({ root, id: values.id })
      if (room === undefined) return fail("RoomNotFound", EXIT.declined)
      const run = await readRun({ root, id: values.id })
      const process = run === undefined ? undefined : { ...run, alive: alive(run.pid) }
      if (values.json) console.log(JSON.stringify({ ...room, run: process }, null, 2))
      else
        console.log(
          room.id +
            " " +
            room.state._tag +
            (process === undefined
              ? ""
              : process.alive
                ? " pid " + process.pid
                : " stale process " + process.pid),
        )
      return
    }
    const rooms = await listRooms(root)
    if (values.json) console.log(JSON.stringify(rooms, null, 2))
    else console.log(rooms.map((room) => room.id + " " + room.state._tag).join("\n"))
    return
  }

  if (command === "move")
    return fail(
      "move is not implemented; refusing to record a move that does not happen",
      EXIT.declined,
    )

  if (values.id === undefined) return fail(command + " needs --id (see room --help)", EXIT.usage)
  const id = values.id

  if (command === "up") {
    const room = await readRoom({ root, id })
    if (room === undefined || room.state._tag === "Absent")
      return fail("RoomNotFound", EXIT.declined)
    let worktree = join(roomDir({ root, id }), "worktree")
    // SAFETY: the worktree provider is a process boundary; its failure is infrastructure.
    try {
      worktree = await ensureWorktree({ repo: room.state.repo, base: room.base, root: worktree })
    } catch (cause) {
      return fail("worktree failed: " + String(cause), EXIT.infrastructure)
    }
    if (values.exec === undefined) {
      console.log("room " + id + " ready at " + worktree)
      return
    }
    const running = await readRun({ root, id })
    if (running !== undefined && alive(running.pid))
      return fail("room " + id + " already has supervisor " + running.pid, EXIT.declined)
    await removeRun({ root, id })
    const log = join(roomDir({ root, id }), "room.log")
    const child = spawn(
      process.execPath,
      [
        "--conditions=development",
        supervisor(),
        "--root",
        root,
        "--id",
        id,
        "--cwd",
        worktree,
        "--exec",
        values.exec,
        "--log",
        log,
      ],
      { detached: true, stdio: "ignore" },
    )
    child.unref()
    for (let attempt = 0; attempt < 60; attempt++) {
      const run = await readRun({ root, id })
      if (run !== undefined && alive(run.pid)) {
        console.log(
          "room " + id + " up; supervisor " + run.pid + " runs " + JSON.stringify(values.exec),
        )
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return fail("supervisor did not start; see " + runFile({ root, id }), EXIT.infrastructure)
  }

  if (command === "down") {
    const run = await readRun({ root, id })
    if (run === undefined) return fail("room " + id + " has no process", EXIT.declined)
    const outcome = await signalRun({ root, id, signal: "SIGTERM" })
    if (outcome === "no-process") return fail("room " + id + " has no process", EXIT.declined)
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!alive(run.pid)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await removeRun({ root, id })
    console.log("room " + id + " stopped; supervisor " + run.pid)
    return
  }

  if (command === "pause") {
    const result = await pauseRoom({ root, id, at: Date.now() })
    if (!result.ok) return fail(result.error, EXIT.declined)
    const outcome = await signalRun({ root, id, signal: "SIGSTOP" })
    console.log(
      "room " +
        id +
        " recorded paused; " +
        (outcome === "signalled" ? "process group was signalled" : "no process was signalled"),
    )
    return
  }

  if (command === "resume") {
    const result = await resumeRoom({ root, id, at: Date.now() })
    if (!result.ok) return fail(result.error, EXIT.declined)
    const outcome = await signalRun({ root, id, signal: "SIGCONT" })
    console.log(
      "room " +
        id +
        " recorded ready; " +
        (outcome === "signalled" ? "process group was continued" : "no process was continued"),
    )
    return
  }

  return fail("unknown command " + command + " (see room --help)", EXIT.usage)
}

main().catch((cause) =>
  fail(String(cause), cause instanceof RoomDecodeError ? EXIT.usage : EXIT.infrastructure),
)
