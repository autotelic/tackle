import { Effect } from "effect"
import * as Result from "effect/Result"
import { Schema } from "effect"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { parseArgs } from "node:util"
import { agentOsDatabaseFile, createAgentOsRoom, type AgentOsRoom } from "./AgentOs.ts"
import { alive } from "./run.ts"
import {
  readVmRun,
  removeVmRun,
  VmExecRequest,
  writeVmRun,
  type VmResponse,
} from "./VmSupervisor.ts"

/*
 * One room's VM supervisor, as a process. It boots the room's agentOS instance once, binds
 * `.room/<id>/vm.sock`, and answers one exec request per connection for as long as it lives —
 * which is what makes a second command see the first one's VM. `room vm start` spawns it
 * detached; `room down` and `room vm stop` signal it.
 */

/** Answer one request line: decode it, run it in the room's workspace, report what happened. */
const execute = async (room: AgentOsRoom, line: string): Promise<VmResponse> => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(VmExecRequest))(line)
  if (Result.isFailure(decoded))
    return { kind: "error", message: "request does not decode: " + line.slice(0, 200) }
  const request = decoded.success
  const options: NonNullable<Parameters<typeof room.vm.process.execFile>[2]> = {
    cwd: room.workspace,
    output: { capture: "all" },
  }
  // The lease environment is merged into the guest's own, so a command sees both the room's
  // base environment and the credentials the caller handed over.
  if (request.env !== undefined) options.env = request.env
  const ran = await room.vm.process.execFile(request.command, [...request.args], options).then(
    (result) => ({ ok: true as const, result }),
    (cause: unknown) => ({ ok: false as const, cause }),
  )
  if (!ran.ok) return { kind: "error", message: String(ran.cause) }
  return {
    kind: "result",
    stdout: ran.result.stdout ?? "",
    stderr: ran.result.stderr ?? "",
    // A command that timed out or was cancelled has no exit code; reporting 1 keeps the CLI's
    // exit honest instead of claiming the success a `0` would mean.
    exitCode: ran.result.exitCode ?? (ran.result.outcome === "succeeded" ? 0 : 1),
    outcome: ran.result.outcome,
    error: ran.result.error?.message ?? null,
  }
}

const main = async (): Promise<void> => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      root: { type: "string" },
      id: { type: "string" },
      worktree: { type: "string" },
      "state-dir": { type: "string" },
      socket: { type: "string" },
      log: { type: "string" },
    },
    allowPositionals: false,
  })
  const { root, id, worktree, socket, log } = parsed.values
  const stateDir = parsed.values["state-dir"]
  if (
    root === undefined ||
    id === undefined ||
    worktree === undefined ||
    stateDir === undefined ||
    socket === undefined
  ) {
    console.error(
      "room vm supervise: --root, --id, --worktree, --state-dir and --socket are required",
    )
    process.exit(2)
  }

  const paths = { root, id }
  const existing = await readVmRun(paths)
  if (existing !== undefined && existing.pid !== process.pid && alive(existing.pid)) {
    // One room, one VM. A second supervisor over the same directory would be a second
    // filesystem wearing the room's name, so the live one wins and this one leaves.
    console.error("room vm supervise: " + id + " already has supervisor " + existing.pid)
    process.exit(3)
  }
  // A socket file outlives the process that bound it; unlinking first is what lets a start
  // after a dead supervisor take the path instead of answering EADDRINUSE.
  await rm(socket, { force: true })

  const room = await Effect.runPromise(createAgentOsRoom({ id, worktree, stateDir }))

  // Commands are answered one at a time: the VM is one machine, and two commands racing in it
  // would make "the second sees the first's state" a claim about luck rather than order.
  let pending: Promise<void> = Promise.resolve()
  const server = createServer((connection) => {
    connection.setEncoding("utf8")
    let buffer = ""
    connection.on("data", (chunk: string) => {
      buffer += chunk
      const index = buffer.indexOf("\n")
      if (index < 0) return
      const line = buffer.slice(0, index)
      buffer = ""
      // One rejected answer must not make the queue reject for every later command, so a
      // failure is reported as this request's error and the chain stays live.
      pending = pending
        .then(() => execute(room, line))
        .catch((cause: unknown) => ({ kind: "error" as const, message: String(cause) }))
        .then((response) => {
          connection.end(JSON.stringify(response) + "\n")
        })
    })
    connection.on("error", () => connection.destroy())
  })

  const listening = await new Promise<
    { readonly ok: true } | { readonly ok: false; cause: unknown }
  >((resolve) => {
    server.once("error", (cause: unknown) => resolve({ ok: false, cause }))
    server.listen(socket, () => resolve({ ok: true }))
  })
  if (!listening.ok) {
    console.error("room vm supervise: could not bind " + socket + ": " + String(listening.cause))
    process.exit(3)
  }
  // The record is what a probe reads, so it is written in one shape and the log is set on the
  // one call that was given a path for it.
  const run = {
    pid: process.pid,
    socket,
    worktree,
    stateDir,
    database: agentOsDatabaseFile(stateDir),
    startedAt: Date.now(),
  }
  await writeVmRun({ root, id, run: log === undefined ? run : { ...run, log } })

  // The socket and the record go first, so a stop that is observed by a start is already gone
  // by the time the VM finishes disposing.
  const stop = (): void => {
    server.close()
    void rm(socket, { force: true })
      .then(() => removeVmRun(paths))
      .then(() => room.dispose())
      .finally(() => process.exit(0))
  }
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  process.once("SIGHUP", stop)
}

main().catch((cause) => {
  console.error("room vm supervise: " + String(cause))
  process.exit(3)
})
