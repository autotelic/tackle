import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from './git-exec.ts'

/**
 * Files the engine itself writes into a worktree, never the subject of a real
 * conflict. PROGRESS.md is the session's own note: every ticket branch writing
 * the same root file is what made sibling PRs conflict on scratch state, and a
 * merge drops it instead of stopping for a person.
 */
export const ENGINE_SCRATCH_FILES = ['PROGRESS.md']

/**
 * Ledgers the engine maintains. A conflict on one is a set conflict, not a code
 * conflict: both sides accepted findings, and the answer is the union — dropping
 * either side would un-accept debt and redden the gate it exists to hold green.
 */
export const ENGINE_LEDGER_FILES = ['.jig-baseline.json', '.joggle-baseline.json']

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
 * Resolve a conflicted ledger by unioning its `identities` arrays. Identity
 * strings are content-addressed, so the union is the correct merge: every
 * finding either side accepted stays accepted. Returns false when no ledger is
 * conflicted, or when a conflicted ledger is not the shape we know.
 */
export async function unionLedgerConflict(dir: string): Promise<boolean> {
  let resolved = false
  for (const file of ENGINE_LEDGER_FILES) {
    const status = await git(dir, 'status', '--porcelain', '--', file).catch(() => '')
    if (!/^(UU|AA|DU|UD|AU|UA)/m.test(status)) continue
    try {
      const ours = JSON.parse(await git(dir, 'show', `:2:${file}`)) as { identities?: unknown[] }
      const theirs = JSON.parse(await git(dir, 'show', `:3:${file}`)) as { identities?: unknown[] }
      if (!Array.isArray(ours.identities) || !Array.isArray(theirs.identities)) continue
      const seen = new Set<string>()
      const identities: unknown[] = []
      for (const identity of [...ours.identities, ...theirs.identities]) {
        const key = JSON.stringify(identity)
        if (seen.has(key)) continue
        seen.add(key)
        identities.push(identity)
      }
      await writeFile(
        join(dir, file),
        `${JSON.stringify({ ...ours, ...theirs, identities }, null, 1)}\n`,
      )
      await git(dir, 'add', '--', file)
      resolved = true
    } catch {
      // Not parseable stages (added/added with no base, or a shape we do not
      // know): leave it conflicted for the caller to report.
    }
  }
  return resolved
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
      // Scratch notes are dropped; ledgers are unioned. Anything else is real.
      const scratch = await dropEngineScratch(dir)
      const ledger = await unionLedgerConflict(dir)
      if (!scratch && !ledger) throw error
      await git(dir, 'add', '-A').catch(() => undefined)
      // A commit that only touched the dropped file is now empty; skip it.
      if (attempt % 2 === 1) await git(dir, 'rebase', '--skip').catch(() => undefined)
    }
  }
  throw new Error('rebase kept conflicting after resolving engine scratch files')
}
