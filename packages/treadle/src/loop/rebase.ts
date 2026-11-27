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

/**
 * The conflicted paths git reports, unmerged, in sorted order. Used to say
 * *what* is conflicted rather than "outside the engine's own files", which
 * tells a reader nothing they can act on.
 */
export async function conflictPaths(dir: string): Promise<ReadonlyArray<string>> {
  const status = await git(dir, 'status', '--porcelain').catch(() => '')
  return status
    .split('\n')
    .filter((line) => /^(UU|AA|DU|UD|AU|UA|DD)/.test(line))
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== '')
    .sort()
}

/**
 * Why a conflicted path is conflicted, from the engine's point of view. The
 * classification is what a reader needs: a generated catalog is regenerated,
 * a ledger is unioned, a note is dropped, and only a source file is a
 * judgement about code.
 */
export const conflictKind = (
  path: string,
  options: {
    readonly scratch?: ReadonlyArray<string>
    readonly ledgers?: ReadonlyArray<string>
    readonly generated?: ReadonlyArray<string>
  } = {},
): 'scratch' | 'ledger' | 'generated' | 'source' => {
  const matches = (patterns: ReadonlyArray<string> | undefined): boolean =>
    (patterns ?? []).some((pattern) => path === pattern || path.startsWith(pattern))
  if (matches(options.scratch ?? ENGINE_SCRATCH_FILES)) return 'scratch'
  if (matches(options.ledgers ?? ENGINE_LEDGER_FILES)) return 'ledger'
  if (matches(options.generated)) return 'generated'
  return 'source'
}

/**
 * One sentence naming the conflicted files and what each one is. A `source`
 * conflict is the caller's to report; the others explain themselves.
 */
export const describeConflicts = (
  paths: ReadonlyArray<string>,
  options: {
    readonly scratch?: ReadonlyArray<string>
    readonly ledgers?: ReadonlyArray<string>
    readonly generated?: ReadonlyArray<string>
  } = {},
): string => {
  if (paths.length === 0) return 'no conflicted paths'
  const byKind = new Map<string, string[]>()
  for (const path of paths) {
    const kind = conflictKind(path, options)
    byKind.set(kind, [...(byKind.get(kind) ?? []), path])
  }
  const parts = [...byKind].map(([kind, files]) => `${files.join(', ')} (${kind})`)
  return `${paths.length} conflicted file(s): ${parts.join('; ')}`
}

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
 * Resolve a conflicted generated artifact by taking the integration side. The
 * branch's own Checks regenerate the file, and a stale copy of a generated
 * artifact is never worth stopping the Loop for: two branches producing
 * different compilations of the same inputs is the normal case, not a
 * disagreement about code.
 */
export async function takeIntegrationSide(
  dir: string,
  patterns: ReadonlyArray<string>,
): Promise<boolean> {
  if (patterns.length === 0) return false
  const conflicted = await conflictPaths(dir)
  const generated = conflicted.filter(
    (path) => conflictKind(path, { generated: patterns }) === 'generated',
  )
  if (generated.length === 0) return false
  for (const path of generated) {
    /* Stage 2 is the side already applied (the upstream/integration tree). */
    const applied = await git(dir, 'checkout', '--ours', '--', path).then(
      () => true,
      () => false,
    )
    if (applied) await git(dir, 'add', '--', path).catch(() => undefined)
  }
  return true
}

/**
 * Rebase, resolving the engine's own scratch files, its ledgers and the repo's
 * declared generated artifacts between attempts. Any other conflict is the
 * caller's to report: this never guesses at code.
 */
export async function rebaseResolvingScratch(
  dir: string,
  ...args: [...string[], { readonly generatedPaths?: ReadonlyArray<string> } | string]
): Promise<void> {
  /* The last argument may be the option bag, so the git arguments stay
   * positional and the call sites that pass none keep working. */
  const last = args[args.length - 1]
  const options = typeof last === 'object' && last !== null ? last : undefined
  const gitArgs = (options === undefined ? args : args.slice(0, -1)) as string[]
  const generatedPaths = options?.generatedPaths ?? []
  for (let attempt = 0; attempt < ENGINE_SCRATCH_FILES.length * 8; attempt += 1) {
    try {
      if (attempt === 0) await git(dir, 'rebase', ...gitArgs)
      else await git(dir, '-c', 'core.editor=true', 'rebase', '--continue')
      return
    } catch (error) {
      // Scratch notes are dropped, ledgers unioned, generated artifacts taken
      // from the integration side. Anything else is real.
      const scratch = await dropEngineScratch(dir)
      const ledger = await unionLedgerConflict(dir)
      const generated = await takeIntegrationSide(dir, generatedPaths)
      if (!scratch && !ledger && !generated) {
        const remaining = await conflictPaths(dir)
        if (remaining.length > 0) {
          throw new Error(
            `rebase conflicted on ${describeConflicts(remaining, { generated: generatedPaths })}`,
          )
        }
        throw error
      }
      await git(dir, 'add', '-A').catch(() => undefined)
      // A commit that only touched the dropped file is now empty; skip it.
      if (attempt % 2 === 1) await git(dir, 'rebase', '--skip').catch(() => undefined)
    }
  }
  throw new Error('rebase kept conflicting after resolving engine scratch files')
}
