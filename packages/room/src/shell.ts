import { spawnSync } from "node:child_process"

/*
 * The one place the room touches a CLI.
 *
 * A missing binary is a note, not a crash: `doctor` has to be able to say "gh is not here"
 * and keep going. A non-zero exit is a result, not an exception — `gh pr review` can refuse
 * for a reason the caller needs to print.
 */

export interface Outcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export const run = ({
  command,
  args,
  cwd,
  env,
  timeoutMs,
}: {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}): Outcome => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  })
  return {
    code: result.status ?? (result.error === undefined ? 1 : 127),
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr:
      typeof result.stderr === "string" && result.stderr !== ""
        ? result.stderr
        : (result.error?.message ?? ""),
  }
}

export const onPath = (name: string): string | undefined => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = `${dir}/${name}`
    if (spawnSync("test", ["-x", candidate]).status === 0) return candidate
  }
  return undefined
}

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
