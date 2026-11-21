import { Predicate } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))

/** Whether this invocation is `jig room ...`. */
export const isRoomInvocation: Predicate.Predicate<ReadonlyArray<string>> = (argv) =>
  argv[2] === "room"

/**
 * Run the room CLI with the remaining arguments. The door maps nothing: the room's
 * exit codes are the room's, and a missing binary is 127, the shell's number.
 */
export const runRoom = (argv: ReadonlyArray<string>): number => {
  const args = argv.slice(3)
  const onPath = spawnSync("room", args, { stdio: "inherit" })
  if (onPath.error === undefined) return onPath.status ?? 127
  const dist = join(here, "..", "..", "room", "dist", "cli.js")
  const source = join(here, "..", "..", "room", "src", "cli.ts")
  const target = existsSync(dist) ? dist : source
  if (!existsSync(target)) return 127
  const local = spawnSync(process.execPath, ["--conditions=development", target, ...args], {
    stdio: "inherit",
  })
  return local.status ?? 127
}
