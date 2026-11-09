import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clearLeftoverApp } from '../checks.ts'
import type { LoopConfig } from '../config.ts'
import { type Issue, listWorkingIssues } from './tracker.ts'

/**
 * Startup reconciliation (#8): take the lock, kill the previous run's
 * leftover app, and work out whether a working issue needs re-entering.
 */

export type ReconcileResult =
  | { kind: 'fresh'; unlock: () => Promise<void> }
  | { kind: 're-enter'; issue: Issue; unlock: () => Promise<void> }

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The Loop's single-runner lock; also taken by stack maintenance (#17). */
export async function takeLock(repoDir: string): Promise<() => Promise<void>> {
  const dir = join(homedir(), '.treadle', repoDir.replaceAll('/', '-'))
  await mkdir(dir, { recursive: true })
  const lockPath = join(dir, 'lock')
  try {
    const pid = Number.parseInt((await readFile(lockPath, 'utf8')).trim(), 10)
    if (Number.isFinite(pid) && isAlive(pid)) {
      throw new Error(`another Loop holds the lock (pid ${pid}); refusing to start`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('refusing to start')) throw error
    // No lock file: take it.
  }
  await writeFile(lockPath, String(process.pid))
  return () => rm(lockPath, { force: true }).then(() => {})
}

export async function reconcile(repoDir: string, config: LoopConfig): Promise<ReconcileResult> {
  const unlock = await takeLock(repoDir)

  // Kill the previous run's app (#8). The Checks runner itself refuses to
  // run if the port is still busy after this.
  await clearLeftoverApp(join(repoDir, '.treadle', 'app.pid'))

  const working = await listWorkingIssues(repoDir, config)
  if (working.length > 1) {
    await unlock()
    throw new Error(
      `${working.length} issues are ${config.issues.working} (${working.map((i) => `#${i.number}`).join(', ')}). ` +
        'Not guessing which one to re-enter — sort the labels out and start again.',
    )
  }
  const issue = working[0]
  if (issue) return { kind: 're-enter', issue, unlock }
  return { kind: 'fresh', unlock }
}
