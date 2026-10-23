import { Result } from "effect"
import { spawnSync } from "node:child_process"

/*
 * The one place the room touches a CLI.
 *
 * A missing binary is a typed absence, not a crash: `doctor` has to be able to say "gh is
 * not here" and keep going. A non-zero exit is a result, not an exception — `gh pr review`
 * can refuse for a reason the caller needs to print.
 */

/** What a command produced. */
export interface Outcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run a command and collect its streams and exit code.
 *
 * @param input - The binary, its args, and optional cwd, environment, and timeout.
 * @returns The exit code and both streams.
 */
export const run = (input: {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}): Outcome => {
  const options = Object.assign(
    { encoding: "utf8" as const },
    input.cwd === undefined ? {} : { cwd: input.cwd },
    input.env === undefined ? {} : { env: { ...process.env, ...input.env } },
    input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs },
  )
  const result = spawnSync(input.command, [...input.args], options)
  return {
    code: result.status ?? (result.error === undefined ? 1 : 127),
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() || result.error?.message || "",
  }
}

/**
 * Find an executable on PATH.
 *
 * @param name - The binary name.
 * @returns The absolute path, or why it is absent.
 */
export const onPath = (name: string): Result.Result<string, string> => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = `${dir}/${name}`
    if (spawnSync("test", ["-x", candidate]).status === 0) return Result.succeed(candidate)
  }
  return Result.fail(`${name} is not on PATH`)
}
