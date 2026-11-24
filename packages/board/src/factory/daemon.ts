import { Data } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { factoryHome, listWorkstreams } from "./store.ts"
import { alive } from "@autotelic/room/run"
import { watchOnce } from "./watch.ts"

/** A daemon start that cannot proceed. */
class DaemonError extends Data.TaggedError("DaemonError")<{ readonly detail: string }> {}

/** The one-owner lock for a factory daemon on this machine. */
export const daemonLock = (home: string = factoryHome()): string => join(home, "shop.lock")

/** Start the daemon detached; one per FACTORY_HOME. */
export const startDaemon = async (input: {
  readonly worker: string
  readonly intervalMs: number
  readonly home?: string | undefined
}): Promise<number> => {
  await mkdir(input.home ?? factoryHome(), { recursive: true })
  const existing = await readFile(daemonLock(input.home), "utf8").catch(() => undefined)
  if (existing !== undefined) {
    const pid = Number(JSON.parse(existing).pid)
    if (Number.isFinite(pid) && alive(pid))
      throw new DaemonError({ detail: "factory daemon already running: " + pid })
  }
  const log = openSync(join(input.home ?? factoryHome(), "daemon.log"), "a")
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      process.argv[1] ?? "",
      "daemon",
      "run",
      "--worker",
      input.worker,
      "--interval",
      String(input.intervalMs),
    ],
    {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, FACTORY_HOME: input.home ?? factoryHome() },
    },
  )
  closeSync(log)
  child.unref()
  await writeFile(
    daemonLock(input.home),
    JSON.stringify({ pid: child.pid, at: Date.now(), worker: input.worker }, null, 2) + "\n",
  )
  return child.pid ?? -1
}

/** Poll every workstream until stopped; this is the always-on shop, not a session. */
export const runDaemon = async (input: {
  readonly worker: string
  readonly intervalMs: number
  readonly home?: string | undefined
  readonly once?: boolean
}): Promise<void> => {
  // A manually launched `daemon run` (for example under `doppler run`) must publish the same
  // one-owner lock as `daemon start`; otherwise a second start sees no owner and can duplicate
  // the generation. The wrapper parent is allowed because it is the process that holds the
  // outer command, not a second daemon.
  if (input.once !== true) {
    const existing = await readFile(daemonLock(input.home), "utf8").catch(() => undefined)
    if (existing !== undefined) {
      const decoded = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(existing)
      const pid =
        Result.isSuccess(decoded) && typeof decoded.success === "object" && decoded.success !== null
          ? Number((decoded.success as { readonly pid?: unknown }).pid)
          : NaN
      if (Number.isFinite(pid) && pid !== process.pid && pid !== process.ppid && alive(pid))
        throw new DaemonError({ detail: "factory daemon already running: " + pid })
    }
    await mkdir(input.home ?? factoryHome(), { recursive: true })
    await writeFile(
      daemonLock(input.home),
      JSON.stringify({ pid: process.pid, at: Date.now(), worker: input.worker }, null, 2) + "\n",
    )
  }
  const watch = async (record: { readonly id: string }): Promise<void> => {
    for (;;) {
      // SAFETY: the daemon is a process boundary and the loop is its retry: one failed pass is
      // printed and the next poll still runs. The cause is reported, not dropped.
      try {
        const outcome = await watchOnce({
          id: record.id,
          worker: input.worker,
          at: new Date().toISOString(),
          home: input.home,
        })
        if (outcome.appended.length > 0)
          console.log(
            "factory daemon: " +
              record.id +
              " appended " +
              outcome.appended.length +
              ", passes " +
              outcome.passes.length,
          )
      } catch (cause: unknown) {
        console.error("factory daemon: " + record.id + " " + String(cause))
      }
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
    }
  }

  const records = await listWorkstreams({ home: input.home })
  if (input.once === true) {
    await Promise.all(
      records.map(async (record) => {
        // SAFETY: same boundary in one-shot mode — a failed pass is printed, and the other
        // workstreams' passes still run to completion.
        try {
          const outcome = await watchOnce({
            id: record.id,
            worker: input.worker,
            at: new Date().toISOString(),
            home: input.home,
          })
          if (outcome.appended.length > 0)
            console.log(
              "factory daemon: " +
                record.id +
                " appended " +
                outcome.appended.length +
                ", passes " +
                outcome.passes.length,
            )
        } catch (cause: unknown) {
          console.error("factory daemon: " + record.id + " " + String(cause))
        }
      }),
    )
    return
  }

  // One loop per workstream: a 30-minute pass in one repo must not stop another
  // repo from polling, appending events, or starting its own pass.
  const started = new Set<string>()
  for (;;) {
    for (const record of await listWorkstreams({ home: input.home })) {
      if (started.has(record.id)) continue
      started.add(record.id)
      void watch(record)
    }
    await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
  }
}

/** Stop the daemon if its pid is alive. */
export const stopDaemon = async (input?: {
  readonly home?: string | undefined
}): Promise<string> => {
  const text = await readFile(daemonLock(input?.home), "utf8").catch(() => undefined)
  if (text === undefined) return "not running"
  const pid = Number(JSON.parse(text).pid)
  if (Number.isFinite(pid) && alive(pid)) process.kill(pid, "SIGTERM")
  await rm(daemonLock(input?.home), { force: true })
  return "stopped " + pid
}
