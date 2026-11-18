import { Predicate, Result } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

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
  /**
   * Why there is no exit code: a missing binary (`ENOENT`), a buffer overflow (`ENOBUFS`), a
   * timeout. A spawn failure used to be reported as exit 127, which sends the reader hunting for
   * a missing command that is right there.
   */
  readonly failure?: string
}

/**
 * Run a command and collect its streams and exit code.
 *
 * @param input - The binary, its args, and optional cwd, environment, timeout, and buffer.
 * @returns The exit code, both streams, and why there was no exit code when there was none.
 */
export const run = (input: {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  /** Bytes of output to hold. A report too big to hold is a report that never arrived. */
  readonly maxBuffer?: number
}): Outcome => {
  const options = Object.assign(
    { encoding: "utf8" as const, maxBuffer: input.maxBuffer ?? 32 * 1024 * 1024 },
    input.cwd === undefined ? {} : { cwd: input.cwd },
    input.env === undefined ? {} : { env: { ...process.env, ...input.env } },
    input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs },
  )
  const result = spawnSync(input.command, [...input.args], options)
  const outcome: Outcome = {
    code: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() || result.error?.message || "",
  }
  if (result.error === undefined) return outcome
  // Node's spawn error carries the errno as `code` on the common failures (a missing binary,
  // an oversized buffer, a timeout) but the base `Error` type does not declare it, so the
  // presence of the key is the evidence. Falling back to the message keeps an untyped failure
  // printable rather than dropping it.
  const code = "code" in result.error ? result.error.code : undefined
  const failure = Predicate.isString(code) ? code : result.error.message
  return { ...outcome, failure }
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

/**
 * The herdr-core binary, if this machine has it.
 *
 * Two copies existed, one in the command surface and one in the review runner, because each
 * grew its own way to the same fallback: PATH first, then the launcher's install directory.
 * The room has one place it touches a CLI, so this is that place.
 *
 * @returns The absolute path, or nothing when herdr-core is not installed.
 */
export const hcOf = (): Result.Result<string, string> => {
  const global = onPath("hc")
  if (Result.isSuccess(global)) return global
  const local = join(homedir(), ".local", "bin", "hc")
  return existsSync(local)
    ? Result.succeed(local)
    : Result.fail("herdr-core (hc) is not installed: not on PATH, and ~/.local/bin/hc is absent")
}
