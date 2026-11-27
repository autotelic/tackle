import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** GitHub/git operations for the Loop — the state store (#8, ADR-0002). */

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

export async function gh(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, { cwd })
  return stdout.trim()
}

/**
 * Whether a `gh` failure is the network or GitHub having a bad minute rather than a real answer.
 *
 * A 5xx, a gateway page, a reset or a timeout says nothing about the PR; a 404, a 422 or an auth
 * failure does, and retrying those only delays the loud error.
 */
export function isTransientGhFailure(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '',
  ].join('\n')
  return /\b5\d\d\b|bad gateway|service unavailable|gateway time-?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|timed? ?out|could not resolve host|connection (?:reset|refused|error)/i.test(
    text,
  )
}

/** Waits between attempts: a GitHub blip is minutes, not hours. */
export const GH_RETRY_DELAYS_MS = [5_000, 20_000, 60_000, 180_000]

/**
 * `gh`, retried on a transient failure.
 *
 * Used for the PR steps (list, create, ready), where a crash costs more than a wait: the Loop
 * exits on an unhandled error, restarts, re-enters the issue, and each re-entry spends a Pass of
 * the issue's budget on work that already passed its Checks. A 502 on `gh pr ready` parked two
 * finished issues that way. A non-transient failure throws at once.
 */
export async function ghRetry(
  cwd: string,
  args: string[],
  options: {
    readonly delaysMs?: ReadonlyArray<number>
    readonly sleep?: (ms: number) => Promise<void>
    readonly run?: (cwd: string, ...args: string[]) => Promise<string>
  } = {},
): Promise<string> {
  const delays = options.delaysMs ?? GH_RETRY_DELAYS_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const run = options.run ?? gh
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(cwd, ...args)
    } catch (error) {
      const wait = delays[attempt]
      if (wait === undefined || !isTransientGhFailure(error)) throw error
      await sleep(wait)
    }
  }
}

export async function ghJson<T>(cwd: string, ...args: string[]): Promise<T> {
  return JSON.parse(await gh(cwd, ...args)) as T
}

/** True if the branch exists locally or on origin. */
export async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  const local = await git(repoDir, 'rev-parse', '--verify', branch).then(
    () => true,
    () => false,
  )
  if (local) return true
  return await git(repoDir, 'rev-parse', '--verify', `origin/${branch}`).then(
    () => true,
    () => false,
  )
}
