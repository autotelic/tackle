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
