import { Predicate } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { findProjectBin } from "./launcher.ts"

const here = fileURLToPath(new URL(".", import.meta.url))

/** Whether this invocation is `jig room ...`. */
export const isRoomInvocation: Predicate.Predicate<ReadonlyArray<string>> = (argv) =>
  argv[2] === "room"

const EXIT = { notFound: 127, infrastructure: 3 } as const

/** Run a chosen binary; an EACCES or a broken shebang is infrastructure, not a decline. */
const runChosen = (command: string, args: ReadonlyArray<string>): number => {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error !== undefined) return EXIT.infrastructure
  return result.status ?? EXIT.infrastructure
}

/**
 * Run the room CLI with the remaining arguments. The door maps nothing: the room's
 * exit codes are the room's, and a missing binary is 127, the shell's number.
 *
 * The project's own room wins, then PATH, then this package's build — the same policy
 * `jig` uses, through the same walk-up. A repo that pins room is telling us which code
 * its terminals run.
 */
export const runRoom = (argv: ReadonlyArray<string>): number => {
  const args = argv.slice(3)
  const project = findProjectBin({ cwd: process.cwd(), name: "room", exists: existsSync })
  if (project._tag === "Found") return runChosen(project.path, args)

  const onPath = spawnSync("room", args, { stdio: "inherit" })
  if (onPath.error === undefined) return onPath.status ?? EXIT.infrastructure
  const code = "code" in onPath.error ? onPath.error.code : undefined
  if (code !== "ENOENT") return EXIT.infrastructure

  const dist = join(here, "..", "..", "room", "dist", "cli.js")
  const source = join(here, "..", "..", "room", "src", "cli.ts")
  const target = existsSync(dist) ? dist : source
  if (!existsSync(target)) return EXIT.notFound
  return runChosen(process.execPath, ["--conditions=development", target, ...args])
}
