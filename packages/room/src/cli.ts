/* oxlint-disable plumb-effect/no-run-promise-outside-seam -- the CLI is the package's one entry point: it owns argv, the exit code and the process lifetime, so its two command helpers are the seam rather than service modules. */
import { Effect, Option } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, symlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { ExecutorLeaseError, readExecutorLease } from "./ExecutorLease.ts"
import { localRoomProvider } from "./Provider.ts"
import { Worktree, WorktreeLive } from "./Worktree.ts"
import {
  createRoom,
  leaseRoomPort,
  listRooms,
  pauseRoom,
  readRoom,
  releaseRoomPort,
  recordRoomSnapshot,
  resumeRoom,
  setRoomDesired,
  setRoomExec,
  setRoomRuntime,
  setRoomService,
  roomDir,
  RoomDecodeError,
} from "./store.ts"
import { alive, readRun, removeRun, signalRun, startRoomRun } from "./run.ts"
import {
  ensureVmSupervisor,
  observeVmService,
  readVmStatus,
  snapshotRoomVm,
  startVmSupervisor,
  stopVmService,
  stopVmSupervisor,
  vmExec,
  vmHttp,
  vmService,
  type VmExecRequest,
} from "./VmSupervisor.ts"
import { verifySnapshot } from "./VmSnapshot.ts"
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
  "  room vm --id <id> [--root .room] [--json] [--executor-lease <file>] -- <command...>   (run it in the room's VM supervisor)",
  "  room vm start|stop|status --id <id> [--root .room] [--json]   (the room's VM supervisor)",
  "  room vm serve --id <id> --port <vm-port> --exec <command>   (start a VM service)",
  "  room vm serve --id <id> --port <vm-port> --command <program> [--arg <arg>...]   (direct, no shell)",
  "  room vm preview --id <id> --port <vm-port> [--path /] [--json]   (ask the VM service)",
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
  "executor-lease": { type: "string" },
  port: { type: "string" },
  path: { type: "string" },
  command: { type: "string" },
  arg: { type: "string", multiple: true },
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
      const checkedAt = new Date().toISOString()
      // Two places a service can run, so two observations: a VM service is reported from the
      // guest's own process table, and a local room from the supervisor holding its command.
      const service =
        room.service === undefined
          ? null
          : room.runtime?.kind === "agentos" && room.runtime.previewPort !== undefined
            ? await observeVmService({
                root,
                id: values.id,
                service: room.service,
                port: room.runtime.previewPort,
                pid: room.runtime.servicePid,
                checkedAt,
              })
            : room.port === undefined
              ? null
              : await observeService({
                  service: room.service,
                  port: room.port.number,
                  run,
                  checkedAt,
                })
      if (values.json) console.log(JSON.stringify({ ...room, run: process, service }, null, 2))
      else
        console.log(
          room.id +
            " " +
            room.state._tag +
            (room.runtime === undefined ? "" : " runtime " + room.runtime.kind) +
            // A pause that kept the disk and one that could not are the same `Paused` state, so
            // the difference is printed: the record says which of the two this room is.
            (room.runtime?.snapshot === undefined
              ? ""
              : " snapshot " + room.runtime.snapshot.generation) +
            (room.runtime?.snapshotError === undefined
              ? ""
              : " no snapshot (" + room.runtime.snapshotError + ")") +
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

  if (command === "vm") {
    const room = await readRoom({ root, id })
    if (room === undefined || room.state._tag === "Absent")
      return fail("RoomNotFound", EXIT.declined)
    const stateDir = roomDir({ root, id })
    const worktree = join(stateDir, "worktree")
    if (!existsSync(worktree))
      return fail("room " + id + " has no worktree at " + worktree, EXIT.declined)
    const verb = parsed.positionals[0]

    if (verb === "start") {
      const started = await ensureVmSupervisor({ root, id, worktree, stateDir })
      if (!started.ok) return fail(started.reason, EXIT.infrastructure)
      // The runtime is recorded once a VM is actually behind the room, so a room that never
      // started one keeps the local placement its file has always implied.
      const saved = await setRoomRuntime({ root, id, runtime: { kind: "agentos" } })
      if (!saved.ok) return fail(saved.error, EXIT.declined)
      if (values.json) console.log(JSON.stringify(started.run, null, 2))
      else
        console.log(
          "room " + id + " vm supervisor " + started.run.pid + " at " + started.run.socket,
        )
      return
    }

    if (verb === "stop") {
      // The guest service is killed while the VM that holds it can still be asked, so the stop
      // names the process it took instead of leaving the reader to infer it from a disposal.
      const guest = await stopVmService({ root, id, pid: room.runtime?.servicePid })
      const stopped = await stopVmSupervisor({ root, id })
      if (values.json) console.log(JSON.stringify({ ...stopped, service: guest }, null, 2))
      else if (stopped.detail === "absent") console.log("room " + id + " had no vm supervisor")
      else if (stopped.detail === "stale")
        console.log(
          "room " + id + " had a stale vm supervisor " + stopped.pid + "; socket released",
        )
      else
        console.log(
          "room " +
            id +
            " vm supervisor " +
            stopped.pid +
            " stopped" +
            (guest.stopped ? "; vm service " + room.runtime?.servicePid + " killed" : ""),
        )
      return
    }

    if (verb === "status") {
      const status = await readVmStatus({ root, id })
      if (values.json) console.log(JSON.stringify(status, null, 2))
      else if (status.state === "absent")
        console.log(
          "room " + id + " has no vm supervisor" + (status.socket ? "; socket present" : ""),
        )
      else
        console.log(
          "room " +
            id +
            " vm supervisor " +
            status.run?.pid +
            " " +
            status.state +
            (status.socket ? " socket " + status.run?.socket : " no socket"),
        )
      return
    }

    if (verb === "serve") {
      const port = Number(values.port)
      if (
        (values.exec === undefined && values.command === undefined) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      )
        return fail(
          "vm serve needs --exec (shell) or --command/--arg and a --port in 1-65535",
          EXIT.usage,
        )
      const started = await ensureVmSupervisor({ root, id, worktree, stateDir })
      if (!started.ok) return fail(started.reason, EXIT.infrastructure)
      // A direct command avoids a shell between the supervisor and the guest program. Some
      // guest binaries cannot be exec'd through sh -c; --command node --arg … is the path for
      // those services, while --exec remains the convenience shell form.
      const service =
        values.command === undefined
          ? { command: "sh", args: ["-c", values.exec ?? ""] }
          : { command: values.command, args: values.arg ?? [] }
      const response = await vmService({
        socket: started.run.socket,
        request: { kind: "service", ...service },
      }).catch((cause) => fail("vm service: " + String(cause), EXIT.infrastructure))
      if (response.kind === "error")
        return fail("vm service: " + response.message, EXIT.infrastructure)
      if (response.kind !== "service")
        return fail("vm service: unexpected response " + response.kind, EXIT.infrastructure)
      const healthPath = values.health ?? "/"
      if (!healthPath.startsWith("/"))
        return fail("--health must be a path such as /healthz", EXIT.usage)
      const declared = await setRoomService({
        root,
        id,
        service: {
          name: values.service ?? "web",
          command:
            values.command === undefined
              ? (values.exec ?? "")
              : [values.command, ...(values.arg ?? [])].join(" "),
          healthPath,
        },
      })
      if (!declared.ok) return fail(declared.error, EXIT.declined)
      // The guest pid is part of the room's record, not a line in a log: it is the id the VM's
      // process table must be asked about to report the service honestly later.
      const saved = await setRoomRuntime({
        root,
        id,
        runtime: { kind: "agentos", previewPort: port, servicePid: response.pid },
      })
      if (!saved.ok) return fail(saved.error, EXIT.declined)
      if (values.json)
        console.log(
          JSON.stringify({ id, port, pid: response.pid, service: declared.value.service }, null, 2),
        )
      else console.log("room " + id + " vm service pid " + response.pid + " on guest port " + port)
      return
    }

    if (verb === "preview") {
      const port = Number(values.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        return fail("vm preview needs a --port in 1-65535", EXIT.usage)
      const started = await ensureVmSupervisor({ root, id, worktree, stateDir })
      if (!started.ok) return fail(started.reason, EXIT.infrastructure)
      const response = await vmHttp({
        socket: started.run.socket,
        request: { kind: "http", port, path: values.path ?? "/", method: "GET" },
      }).catch((cause) => fail("vm preview: " + String(cause), EXIT.infrastructure))
      if (response.kind === "error")
        return fail("vm preview: " + response.message, EXIT.infrastructure)
      if (response.kind !== "http")
        return fail("vm preview: unexpected response " + response.kind, EXIT.infrastructure)
      const body = Buffer.from(response.body, "base64")
      if (values.json)
        console.log(
          JSON.stringify(
            {
              id,
              port,
              path: values.path ?? "/",
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: body.toString("utf8"),
            },
            null,
            2,
          ),
        )
      else process.stdout.write(body)
      return
    }

    const program = parsed.positionals[0]
    if (program === undefined)
      return fail("vm needs a command after -- (see room --help)", EXIT.usage)
    // The executor lease is the room's only path to a credential. It is read before anything
    // starts, expiry-checked, and passed per command; the host environment is never forwarded.
    const leasePath = values["executor-lease"]
    const lease =
      leasePath === undefined
        ? undefined
        : await readExecutorLease(resolve(leasePath), Date.now()).catch((cause) =>
            fail(
              "executor lease: " +
                (cause instanceof ExecutorLeaseError
                  ? cause._tag + ": " + cause.message
                  : String(cause)),
              EXIT.declined,
            ),
          )
    const env =
      lease === undefined
        ? undefined
        : {
            ...lease.env,
            EXECUTOR_WORKSTREAM: lease.workstream,
            EXECUTOR_EXPIRES_AT: lease.expiresAt,
          }
    // The supervisor owns the VM, so this command joins the room's VM instead of booting one:
    // the mount is the room's checkout and the database is the room's directory, so the state
    // a previous command left behind is the state this one starts from.
    const started = await ensureVmSupervisor({ root, id, worktree, stateDir })
    if (!started.ok) return fail(started.reason, EXIT.infrastructure)
    const saved = await setRoomRuntime({ root, id, runtime: { kind: "agentos" } })
    if (!saved.ok) return fail(saved.error, EXIT.declined)
    const args = parsed.positionals.slice(1)
    const request: VmExecRequest =
      env === undefined
        ? { kind: "exec", command: program, args }
        : { kind: "exec", command: program, args, env }
    const response = await vmExec({ socket: started.run.socket, request }).catch((cause) =>
      fail("vm failed: " + String(cause), EXIT.infrastructure),
    )
    if (response.kind === "error")
      return fail("vm failed: " + response.message, EXIT.infrastructure)
    if (response.kind !== "result")
      return fail("vm failed: unexpected response " + response.kind, EXIT.infrastructure)
    if (values.json)
      console.log(
        JSON.stringify(
          {
            id,
            command: program,
            args,
            stdout: response.stdout,
            stderr: response.stderr,
            exitCode: response.exitCode,
            outcome: response.outcome,
            error: response.error,
          },
          null,
          2,
        ),
      )
    else {
      if (response.stdout !== "") process.stdout.write(response.stdout)
      if (response.stderr !== "") process.stderr.write(response.stderr)
    }
    return process.exit(response.exitCode)
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
    // A dead supervisor pid is stale, not a live pass: a room whose record outlived its process
    // has nothing to stop, and `down` is what clears the debris.
    const vm = await readVmStatus({ root, id })
    // A room that was raised without a supervisor still owns a lease; `down` is what releases it.
    if (run === undefined && room.port === undefined && vm.state === "absent")
      return fail("room " + id + " has no process", EXIT.declined)
    // Clear desire before the signal: the shop must not restart it during the stop.
    await setRoomDesired({ root, id, desired: false })
    // The guest service is killed first, while the VM that holds it can still be asked; a stale
    // record has no process table, and the disposal below is the stop that remains.
    const guest = await stopVmService({ root, id, pid: room.runtime?.servicePid })
    // The VM supervisor goes next: it holds the socket, and a room that stops its command while
    // its VM still answers is not stopped.
    const vmStop = vm.state === "absent" ? undefined : await stopVmSupervisor({ root, id })
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
    const parts = ["room " + id + " stopped"]
    if (guest.stopped) parts.push("killed vm service " + room.runtime?.servicePid)
    if (run !== undefined) parts.push("supervisor " + run.pid)
    if (vmStop !== undefined && vmStop.pid !== undefined)
      parts.push("vm supervisor " + vmStop.pid + (vmStop.detail === "stale" ? " (stale)" : ""))
    if (room.port !== undefined) parts.push("released port " + room.port.number)
    console.log(parts.join("; "))
    return
  }

  if (command === "pause") {
    const result = await pauseRoom({ root, id, at: Date.now() })
    if (!result.ok) return fail(result.error, EXIT.declined)
    const stateDir = resolve(roomDir({ root, id }))
    // A room placed in a VM has a disk worth keeping; a local room has only its record, which is
    // already written. The generation is one past the last capture, so a resumed room's next
    // pause writes its own file instead of overwriting the one its VM was restored from.
    const parts: string[] = []
    if (result.value.runtime !== undefined) {
      const captured = await snapshotRoomVm({
        root,
        id,
        stateDir,
        generation: (result.value.runtime.snapshot?.generation ?? 0) + 1,
        at: Date.now(),
      })
      const recorded = await recordRoomSnapshot({ root, id, outcome: captured })
      if (!recorded.ok) return fail(recorded.error, EXIT.declined)
      if (captured.ok) {
        // The file is the paused room's disk now, so the process that held the disk stops: a
        // resume builds a new VM from the snapshot rather than thawing the old one.
        const stopped = await stopVmSupervisor({ root, id })
        parts.push(
          "snapshot " +
            captured.snapshot.path +
            " (" +
            captured.snapshot.bytes +
            " bytes, " +
            captured.snapshot.entries +
            " entries, sha256 " +
            captured.snapshot.sha256.slice(0, 12) +
            ")" +
            (stopped.pid === undefined ? "" : "; vm supervisor " + stopped.pid + " stopped"),
        )
      } else parts.push("no snapshot was written: " + captured.reason)
    }
    const outcome = await signalRun({ root, id, signal: "SIGSTOP" })
    parts.push(outcome === "signalled" ? "process group was signalled" : "no process was signalled")
    console.log("room " + id + " recorded paused; " + parts.join("; "))
    return
  }

  if (command === "resume") {
    const current = await readRoom({ root, id })
    if (current === undefined) return fail("RoomNotFound", EXIT.declined)
    const snapshot = current.runtime?.snapshot
    // The file is checked before the room is called ready: a room that says ready while the disk
    // it kept is missing or altered is exactly the claim this pause exists to stop making.
    if (snapshot !== undefined) {
      const verified = await verifySnapshot(snapshot)
      if (!verified.ok) return fail(verified.reason, EXIT.declined)
    }
    const result = await resumeRoom({ root, id, at: Date.now() })
    if (!result.ok) return fail(result.error, EXIT.declined)
    const parts: string[] = []
    if (snapshot !== undefined) {
      const stateDir = resolve(roomDir({ root, id }))
      const worktree = join(stateDir, "worktree")
      if (!existsSync(worktree))
        return fail("room " + id + " has no worktree at " + worktree, EXIT.declined)
      // A fresh VM directory, so the files it reads come from the snapshot's lowers and not from
      // the previous VM's overlay. The old supervisor is stopped first for the same reason.
      const vmStateDir = join(stateDir, "vm-" + snapshot.generation)
      await mkdir(vmStateDir, { recursive: true })
      await stopVmSupervisor({ root, id })
      const started = await startVmSupervisor({
        root,
        id,
        worktree,
        stateDir: vmStateDir,
        snapshot: snapshot.path,
      })
      if (!started.ok) {
        // A room that cannot restore its disk is not ready to work: it goes back to paused with
        // the reason, so the next reader sees a failure instead of an empty VM.
        const paused = await pauseRoom({ root, id, at: Date.now() })
        if (paused.ok)
          await recordRoomSnapshot({
            root,
            id,
            outcome: { ok: false, reason: "the snapshot could not be restored: " + started.reason },
          })
        return fail("the snapshot could not be restored: " + started.reason, EXIT.infrastructure)
      }
      parts.push(
        "restored snapshot " +
          snapshot.path +
          " into vm supervisor " +
          started.run.pid +
          " at " +
          vmStateDir,
      )
    }
    const outcome = await signalRun({ root, id, signal: "SIGCONT" })
    parts.push(outcome === "signalled" ? "process group was continued" : "no process was continued")
    console.log("room " + id + " recorded ready; " + parts.join("; "))
    return
  }

  return fail("unknown command " + command + " (see room --help)", EXIT.usage)
}

main().catch((cause) =>
  fail(String(cause), cause instanceof RoomDecodeError ? EXIT.usage : EXIT.infrastructure),
)
