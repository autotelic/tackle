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
