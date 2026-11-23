import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { removeRun, RoomRun, writeRun } from "./run.ts"

/*
 * One room's supervisor. It is the process-group leader for the command it runs, so a
 * SIGSTOP to the group freezes both and a SIGCONT resumes both. It is started detached by
 * `room up`; the room file records this pid, never the command's.
 */

const main = (): void => {
  const options = {
    root: { type: "string" },
    id: { type: "string" },
    cwd: { type: "string" },
    exec: { type: "string" },
    log: { type: "string" },
    port: { type: "string" },
  } as const

  const parsed = parseArgs({ args: process.argv.slice(2), options, allowPositionals: false })
  const { root, id, cwd, exec, log, port } = parsed.values
  if (
    root === undefined ||
    id === undefined ||
    cwd === undefined ||
    exec === undefined ||
    log === undefined
  ) {
    console.error("room supervise: --root, --id, --cwd, --exec and --log are required")
    process.exit(2)
  }

  const runPath = { root, id }
  let stopping = false
  let child: ChildProcess | undefined
  let restarts: Array<number> = []

  // A declared service is told its leased port as `PORT`, the name every dev server and
  // framework already reads. The supervisor invents nothing: with no lease there is no port.
  const env = port === undefined ? process.env : { ...process.env, PORT: port }

  const record = (childPid: number): RoomRun => ({
    pid: process.pid,
    child: childPid,
    exec,
    startedAt: Date.now(),
    log,
  })

  const start = (): void => {
    const fd = openSync(log, "a")
    child = spawn("/bin/sh", ["-c", exec], {
      cwd,
      stdio: ["ignore", fd, fd],
      env,
    })
    closeSync(fd)
    if (child.pid !== undefined) void writeRun({ ...runPath, run: record(child.pid) })

    child.once("exit", () => {
      if (stopping) {
        process.exit(0)
      }
      const at = Date.now()
      restarts = [...restarts.filter((time) => at - time < 60_000), at]
      if (restarts.length > 5) {
        console.error("room supervise: " + id + " crash-looped; stopping")
        void removeRun(runPath).finally(() => process.exit(3))
        return
      }
      setTimeout(start, 500)
    })
  }

  const stop = (signal: NodeJS.Signals): void => {
    stopping = true
    if (child !== undefined && child.pid !== undefined) child.kill(signal)
    setTimeout(() => process.exit(0), 1_000).unref()
  }

  process.once("SIGTERM", () => stop("SIGTERM"))
  process.once("SIGINT", () => stop("SIGINT"))
  process.once("SIGHUP", () => stop("SIGHUP"))

  void mkdir(join(root, id), { recursive: true }).then(start)
}

main()
