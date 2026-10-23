import { Option, Predicate } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/*
 * `jig room` forwards to the room CLI.
 *
 * jig never links the tools it drives — it shells out, and the seam is the command line.
 * `room` is the same shape: a binary, found on PATH, then this checkout's build, then its
 * source under the development condition.
 */

const packageRoot = (): string => fileURLToPath(new URL("..", import.meta.url))

const onPath = (name: string): Option.Option<string> => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return Option.some(candidate)
  }
  return Option.none()
}

/**
 * Whether this invocation is `jig room ...`.
 *
 * @param argv - The process arguments, including node and the script.
 * @returns True when the first word is `room`.
 */
export const isRoomInvocation: Predicate.Predicate<ReadonlyArray<string>> = (argv) =>
  argv[2] === "room"

/**
 * Run the room CLI with the remaining arguments.
 *
 * @param argv - The process arguments, including node and the script.
 * @returns The room CLI's exit code.
 */
export const runRoom = (argv: ReadonlyArray<string>): number => {
  const rest = argv.slice(3)
  const override = process.env.ROOM_BIN
  if (override !== undefined && override !== "") {
    return spawn(override, rest)
  }
  const global = Option.getOrUndefined(onPath("room"))
  if (global !== undefined) return spawn(global, rest)
  const built = join(packageRoot(), "..", "room", "dist", "cli.js")
  if (existsSync(built)) return spawn(process.execPath, [built, ...rest])
  const source = join(packageRoot(), "..", "room", "src", "cli.ts")
  return spawn(process.execPath, ["--conditions=development", source, ...rest])
}

const spawn = (command: string, args: ReadonlyArray<string>): number => {
  const result = spawnSync(command, [...args], { stdio: "inherit" })
  return result.status ?? (result.error === undefined ? 1 : 127)
}
