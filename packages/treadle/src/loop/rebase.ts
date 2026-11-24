import { git } from './git-exec.ts'

/**
 * Files the engine itself writes into a worktree, never the subject of a real
 * conflict. PROGRESS.md is the session's own note: every ticket branch writing
 * the same root file is what made sibling PRs conflict on scratch state, and a
 * merge drops it instead of stopping for a person.
 */
export const ENGINE_SCRATCH_FILES = ['PROGRESS.md']

/** Resolve a conflicted engine-owned scratch file by dropping it. False when none is conflicted. */
export async function dropEngineScratch(dir: string): Promise<boolean> {
  let dropped = false
  for (const file of ENGINE_SCRATCH_FILES) {
    const status = await git(dir, 'status', '--porcelain', '--', file).catch(() => '')
    if (!/^(UU|AA|DU|UD|AU|UA|DD)/m.test(status)) continue
    // Both sides: the file is not wanted in the result.
    await git(dir, 'rm', '--quiet', '--force', '--', file).catch(() => undefined)
    dropped = true
  }
  return dropped
}

/**
 * Rebase, resolving only the engine's own scratch files between attempts. Any
 * other conflict is the caller's to report: this never guesses at code.
 */
export async function rebaseResolvingScratch(dir: string, ...args: string[]): Promise<void> {
  for (let attempt = 0; attempt < ENGINE_SCRATCH_FILES.length * 8; attempt += 1) {
    try {
      if (attempt === 0) await git(dir, 'rebase', ...args)
      else await git(dir, '-c', 'core.editor=true', 'rebase', '--continue')
      return
    } catch (error) {
      if (!(await dropEngineScratch(dir))) throw error
      await git(dir, 'add', '-A').catch(() => undefined)
      // A commit that only touched the dropped file is now empty; skip it.
      if (attempt % 2 === 1) await git(dir, 'rebase', '--skip').catch(() => undefined)
    }
  }
  throw new Error('rebase kept conflicting after resolving engine scratch files')
}
