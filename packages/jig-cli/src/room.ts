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

const onPath = (name: string): string | undefined => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export const isRoomInvocation = (argv: ReadonlyArray<string>): boolean => argv[2] === "room"

export const runRoom = (argv: ReadonlyArray<string>): number => {
  const override = process.env.ROOM_BIN
  const global = onPath("room")
  const built = join(packageRoot(), "..", "room", "dist", "cli.js")
  const source = join(packageRoot(), "..", "room", "src", "cli.ts")
  const [command, args] =
    override !== undefined && override !== ""
      ? [override, [] as ReadonlyArray<string>]
      : global !== undefined
        ? [global, [] as ReadonlyArray<string>]
        : existsSync(built)
          ? [process.execPath, [built]]
          : [process.execPath, ["--conditions=development", source]]
  const result = spawnSync(command, [...args, ...argv.slice(3)], { stdio: "inherit" })
  return result.status ?? (result.error === undefined ? 1 : 127)
}
