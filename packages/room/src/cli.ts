/* oxlint-disable plumb-effect/no-run-promise-outside-seam -- the CLI is the package's one entry point: it owns argv, the exit code and the process lifetime, so its two command helpers are the seam rather than service modules. */
import { Effect, Option } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, symlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { localRoomProvider } from "./Provider.ts"
import { Worktree, WorktreeLive } from "./Worktree.ts"
import {
  createRoom,
  leaseRoomPort,
  listRooms,
  pauseRoom,
  readRoom,
  releaseRoomPort,
  resumeRoom,
  setRoomDesired,
  setRoomExec,
  setRoomService,
  roomDir,
  RoomDecodeError,
} from "./store.ts"
import { alive, readRun, removeRun, signalRun, startRoomRun } from "./run.ts"
import { observeService } from "./Service.ts"

const usage = [
  "room — one durable place per scope",
  "",
  "Usage:",
  "  room new --repo <path> --scope <name> [--base main] [--branch <existing>] [--worktree <existing>] [--id <id>] [--root .room]",
  "  room up --id <id> [--exec <command>] [--service <name>] [--health <path>] [--root .room]",
  "  room down --id <id> [--root .room]",
  "  room status [--id <id>] [--root .room] [--json]",
  "  room pause --id <id> [--root .room]",
  "  room resume --id <id> [--root .room]",
  "  room use --id <id> [--root .room]   (label this Herdr terminal with room=<id>)",
  "  room run --id <id> [--root .room] -- <command...>",
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
  branch: { type: "string" },
  worktree: { type: "string" },
  id: { type: "string" },
  root: { type: "string", default: ".room" },
  to: { type: "string" },
  json: { type: "boolean", default: false },
  exec: { type: "string" },
  service: { type: "string" },
  health: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const

/** HC_BIN first, then PATH, then the installer's default location. */
const hcBin = (): Option.Option<string> => {
  if (process.env.HC_BIN !== undefined && process.env.HC_BIN !== "")
    return Option.some(process.env.HC_BIN)
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, "hc")
    if (existsSync(candidate)) return Option.some(candidate)
  }
  const local = join(homedir(), ".local", "bin", "hc")
  return existsSync(local) ? Option.some(local) : Option.none()
}

const runHc = (args: ReadonlyArray<string>) => {
  const binary = hcBin()
  if (Option.isNone(binary)) return { ok: false as const, message: "hc is not on PATH" }
  const result = spawnSync(binary.value, [...args], { encoding: "utf8" })
  return result.status === 0
    ? { ok: true as const, output: result.stdout }
    : {
        ok: false as const,
        message: result.stderr.trim() || result.error?.message || "hc exited " + result.status,
      }
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "room"

const attachWorktree = (input: {
  readonly id: string
  readonly repo: string
  readonly branch: string
  readonly root: string
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const trees = yield* Worktree
      return yield* localRoomProvider(trees).attach(input)
    }).pipe(Effect.provide(WorktreeLive)),
  )

const ensureWorktree = (input: {
  readonly id: string
  readonly repo: string
  readonly base: string
  readonly root: string
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const trees = yield* Worktree
      return yield* localRoomProvider(trees).ensure(input)
    }).pipe(Effect.provide(WorktreeLive)),
  )

const main = async (): Promise<void> => {
  const command = process.argv[2]
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(usage)
    return
  }
  const parsed = parseArgs({ args: process.argv.slice(3), options, allowPositionals: true })
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
    let worktree: string
    if (values.worktree !== undefined) {
      const source = resolve(values.worktree)
      if (!existsSync(source)) return fail("worktree does not exist: " + source, EXIT.usage)
      if ((await readRoom({ root, id })) !== undefined)
        return fail("RoomAlreadyExists", EXIT.declined)
      const link = join(roomDir({ root, id }), "worktree")
      await mkdir(dirname(link), { recursive: true })
      // The room directory is a lease over an existing checkout, not a second copy of it.
      await symlink(source, link)
      worktree = source
    } else {
      // SAFETY: the room provider is a process boundary; its failure is infrastructure.
      // oxlint-disable-next-line plumb-effect/no-try-catch -- the CLI owns the process boundary.
      try {
        worktree =
          values.branch === undefined
            ? await ensureWorktree({
                id,
                repo: values.repo,
                base: values.base,
                root,
              })
            : await attachWorktree({
                id,
                repo: values.repo,
                branch: values.branch,
                root,
              })
      } catch (cause) {
        return fail("worktree failed: " + String(cause), EXIT.infrastructure)
      }
    }
    const created = await createRoom({
      root,
      id,
      repo: values.repo,
      scope: values.scope,
      base: values.branch ?? values.base,
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
      // The status is what a probe saw just now, never the declaration's optimism: a room whose
      // service does not answer says so here, with the evidence the probe collected.
      const service =
        room.service === undefined || room.port === undefined
          ? null
          : await observeService({
              service: room.service,
              port: room.port.number,
              run,
              checkedAt: new Date().toISOString(),
            })
      if (values.json) console.log(JSON.stringify({ ...room, run: process, service }, null, 2))
      else
        console.log(
          room.id +
            " " +
            room.state._tag +
            (room.port === undefined ? "" : " port " + room.port.number) +
            (service === null
              ? ""
              : " service " +
                service.name +
                " " +
                service.status +
                (service.detail === null ? "" : " (" + service.detail + ")")) +
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

  if (command === "run") {
    const room = await readRoom({ root, id })
    if (room === undefined || room.state._tag === "Absent")
      return fail("RoomNotFound", EXIT.declined)
    if (parsed.positionals.length === 0)
      return fail("run needs a command after -- (see room --help)", EXIT.usage)
    const worktree = await ensureWorktree({
      id,
      repo: room.state.repo,
      base: room.base,
      root,
    }).catch((cause) => fail("worktree failed: " + String(cause), EXIT.infrastructure))
    const binary = hcBin()
    if (Option.isNone(binary)) return fail("hc is not on PATH", EXIT.infrastructure)
    const child = spawnSync(
      binary.value,
      ["run", "--label", "room=" + id, "--cwd", worktree, "--", ...parsed.positionals],
      { stdio: "inherit" },
    )
    return process.exit(child.status ?? EXIT.infrastructure)
  }

  if (command === "use") {
    const terminal = process.env.HC_TERMINAL_ID
    if (terminal === undefined || terminal === "")
      return fail(
        "use needs HC_TERMINAL_ID; run it from a Herdr terminal (hc run/inject)",
        EXIT.declined,
      )
    const room = await readRoom({ root, id })
    if (room === undefined) return fail("RoomNotFound", EXIT.declined)
    const probe = runHc(["get", terminal, "--json"])
    if (!probe.ok)
      return fail("hc could not find terminal " + terminal + ": " + probe.message, EXIT.declined)
    const labeled = runHc(["label", terminal, "room=" + id])
    if (!labeled.ok)
      return fail(
        "hc could not label terminal " + terminal + ": " + labeled.message,
        EXIT.infrastructure,
      )
    console.log("room " + id + " labels terminal " + terminal)
    return
  }

  if (command === "up") {
    const room = await readRoom({ root, id })
    if (room === undefined || room.state._tag === "Absent")
      return fail("RoomNotFound", EXIT.declined)
    const health = values.health
    if (values.service !== undefined && health === undefined)
      return fail(
        "--service needs --health (a service with no health path cannot be probed)",
        EXIT.usage,
      )
    if (health !== undefined && !health.startsWith("/"))
      return fail("--health must be a path such as /healthz", EXIT.usage)
    // One field names the command: what this `up` passed, else the service already declared,
    // else the plain command remembered from an earlier `up`.
    const exec = values.exec ?? room.service?.command ?? room.exec
    if (health !== undefined && exec === undefined)
      return fail("--health needs --exec (nothing would run to answer it)", EXIT.usage)
    const service =
      health !== undefined && exec !== undefined
        ? { name: values.service ?? room.service?.name ?? "web", command: exec, healthPath: health }
        : room.service === undefined || exec === undefined
          ? room.service
          : { ...room.service, command: exec }
    let worktree: string
    // SAFETY: the worktree provider is a process boundary; its failure is infrastructure.
    try {
      worktree = await ensureWorktree({ id, repo: room.state.repo, base: room.base, root })
    } catch (cause) {
      return fail("worktree failed: " + String(cause), EXIT.infrastructure)
    }
    // Lease before anything runs: a room that is up owns one port, and an `up` that fails to
    // start must not leave the lease behind.
    const leased = await leaseRoomPort({ root, id, at: Date.now() })
    if (!leased.ok) return fail(leased.error, EXIT.declined)
    const port = leased.value.port
    if (port === undefined) return fail("PortLeaseMissing", EXIT.infrastructure)
    // The declaration is persisted before the process starts, so a supervisor the shop restarts
    // later finds the same service it is observing now.
    if (service !== undefined) {
      const saved = await setRoomService({ root, id, service })
      if (!saved.ok) return fail(saved.error, EXIT.declined)
    } else if (values.exec !== undefined) {
      const saved = await setRoomExec({ root, id, exec: values.exec })
      if (!saved.ok) return fail(saved.error, EXIT.declined)
    }
    if (exec === undefined) {
      console.log("room " + id + " ready at " + worktree + "; port " + port.number)
      return
    }
    const running = await readRun({ root, id })
    if (running !== undefined && alive(running.pid))
      return fail("room " + id + " already has supervisor " + running.pid, EXIT.declined)
    const started = await startRoomRun({
      root,
      id,
      worktree,
      exec,
      log: join(roomDir({ root, id }), "room.log"),
      port: port.number,
    })
    if (!started.ok) {
      await releaseRoomPort({ root, id })
      return fail(started.reason, EXIT.infrastructure)
    }
    await setRoomDesired({ root, id, desired: true })
    console.log(
      "room " +
        id +
        " up; supervisor " +
        started.run.pid +
        " runs " +
        JSON.stringify(exec) +
        "; port " +
        port.number +
        (service === undefined ? "" : "; service " + service.name + " at " + service.healthPath),
    )
    return
  }

  if (command === "down") {
    const room = await readRoom({ root, id })
    if (room === undefined) return fail("RoomNotFound", EXIT.declined)
    const run = await readRun({ root, id })
    // A room that was raised without a supervisor still owns a lease; `down` is what releases it.
    if (run === undefined && room.port === undefined)
      return fail("room " + id + " has no process", EXIT.declined)
    // Clear desire before the signal: the shop must not restart it during the stop.
    await setRoomDesired({ root, id, desired: false })
    if (run !== undefined) {
      // A supervisor that died between the read and the signal needs no wait; the room is
      // stopped either way, so only the signalled case has a process to wait for.
      const outcome = await signalRun({ root, id, signal: "SIGTERM" })
      if (outcome === "signalled") {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (!alive(run.pid)) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      await removeRun({ root, id })
    }
    // The lease outlives the process it protects: releasing it before the stop finished would
    // hand the next room a port this one is still bound to.
    const released = await releaseRoomPort({ root, id })
    if (!released.ok) return fail(released.error, EXIT.declined)
    const lease = room.port === undefined ? "" : "; released port " + room.port.number
    console.log(
      run === undefined
        ? "room " + id + " stopped" + lease
        : "room " + id + " stopped; supervisor " + run.pid + lease,
    )
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
