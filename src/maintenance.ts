#!/usr/bin/env node
/**
 * Stack maintenance (#17 follow-up, ADR-0002): keeps stacked loop branches
 * and PRs healthy as merges land at human pace, without a person.
 *
 * - A merged loop/<n> PR: the issue is marked done (markdown tracker; on
 *   GitHub the PR's "Closes #" closes the issue itself), the merged branch is
 *   deleted, and every open issue based on it gets its branch rebased onto
 *   the updated default branch and its PR retargeted. Deeper stack levels are
 *   rebased onto their freshly-rebased parents (their PR bases stay put).
 * - A loop PR closed without merging, on an issue nobody is steering (no
 *   state): the issue parks for a human decision.
 *
 * Branches the loop is working right now (`working` state) are never
 * rebased; their turn comes when they finish or park. Conflicts never touch
 * the branch — they're notifications for a person.
 *
 * Usage: node src/maintenance.ts --repo <path>
 *
 * Exit code 0 always: conflicts and skips are reported, not process failures.
 */
import { resolve } from 'node:path'
import { type LoopConfig, loadConfig } from './config.ts'
import { branchExists, gh, ghJson, git } from './loop/git-exec.ts'
import { readIssueFiles } from './loop/markdown-tracker.ts'
import { takeLock } from './loop/reconcile.ts'
import { type Issue, parseBaseFromBody, relabel, resolveBaseRef } from './loop/tracker.ts'
import { loadTelePiConfig, sendTelegramMessage } from './telepi.ts'

export type MaintenanceReport = {
  markedDone: number[]
  rebased: number[]
  retargeted: number[]
  deletedBranches: string[]
  parked: number[]
  skippedWorking: number[]
  conflicts: string[]
}

function emptyReport(): MaintenanceReport {
  return {
    markedDone: [],
    rebased: [],
    retargeted: [],
    deletedBranches: [],
    parked: [],
    skippedWorking: [],
    conflicts: [],
  }
}

/** Injectable seams for tests: everything GitHub goes through these. */
export type MaintenanceDeps = {
  ghFn: typeof gh
  ghJsonFn: typeof ghJson
}

type MergedPr = { number: number; headRefName: string; baseRefName: string }

function loopIssueNumber(headRefName: string): number | null {
  const match = headRefName.match(/^loop\/(\d+)$/)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

/** The issue's current state: markdown = its one label; GitHub = its treadle label. */
async function issueState(
  repoDir: string,
  config: LoopConfig,
  issue: number,
  deps: MaintenanceDeps,
): Promise<string | null> {
  if (config.issues.tracker === 'markdown') {
    const files = await readIssueFiles(config.issues.dir as string)
    return files.find((file) => file.number === issue)?.state ?? null
  }
  const labels = await deps.ghJsonFn<{ labels: { name: string }[] }>(
    repoDir,
    'issue',
    'view',
    String(issue),
    '--json',
    'labels',
  )
  const treadle = new Set([config.issues.ready, config.issues.working, config.issues.parked])
  return labels.labels.find((label) => treadle.has(label.name))?.name ?? null
}

/** Open (not done) issues stacked directly on `base`. */
async function dependentsOf(
  repoDir: string,
  config: LoopConfig,
  base: number,
  deps: MaintenanceDeps,
): Promise<number[]> {
  if (config.issues.tracker === 'markdown') {
    const files = await readIssueFiles(config.issues.dir as string)
    return files
      .filter((file) => file.base === base && file.state !== 'done')
      .map((file) => file.number)
      .sort((a, b) => a - b)
  }
  const open = await deps.ghJsonFn<{ number: number; body: string }[]>(
    repoDir,
    'issue',
    'list',
    '--state',
    'open',
    '--json',
    'number,body',
    '--limit',
    '100',
  )
  return open
    .filter((issue) => parseBaseFromBody(issue.body) === base)
    .map((issue) => issue.number)
    .sort((a, b) => a - b)
}

export async function maintenance(options: {
  repoDir: string
  config: LoopConfig
  notify?: (text: string) => Promise<void>
  /** Take the Loop's lock first. False when called from inside the Loop. */
  withLock?: boolean
  deps?: MaintenanceDeps
}): Promise<MaintenanceReport> {
  const { repoDir, config } = options
  const deps: MaintenanceDeps = options.deps ?? { ghFn: gh, ghJsonFn: ghJson }
  const notify =
    options.notify ??
    (async (text: string) => {
      console.log(`[maintenance] ${text}`)
    })
  const report = emptyReport()

  const unlock =
    options.withLock === false
      ? async () => {}
      : await takeLock(repoDir).catch((error: unknown) => {
          // The Loop is running; maintenance comes back next cycle.
          console.log(`[maintenance] ${error instanceof Error ? error.message : String(error)}`)
          return null
        })
  if (unlock === null) return report

  try {
    const defaultBase = await resolveBaseRef(repoDir, { number: 0, title: '', body: '' })
    await git(repoDir, 'fetch', 'origin', '--prune')

    const conflicted = new Set<number>()

    const rebaseDependent = async (
      issue: number,
      parent: number,
      newBase: string,
      retarget: boolean,
    ): Promise<void> => {
      if (conflicted.has(parent)) return
      const branch = `loop/${issue}`
      const state = await issueState(repoDir, config, issue, deps)
      if (state === config.issues.working) {
        report.skippedWorking.push(issue)
        return
      }
      if (!(await branchExists(repoDir, `origin/${branch}`))) {
        // No branch on the remote: nothing to rebase (a never-started issue
        // branches fresh from its normalized base when it's picked).
        return
      }
      const parentBranch = `loop/${parent}`
      const upstream = (await branchExists(repoDir, `origin/${parentBranch}`))
        ? `origin/${parentBranch}`
        : newBase
      if (!(await branchExists(repoDir, branch)))
        await git(repoDir, 'branch', branch, `origin/${branch}`)
      const before = await git(repoDir, 'rev-parse', branch)
      try {
        await git(repoDir, 'rebase', '--onto', newBase, upstream, branch)
      } catch {
        await git(repoDir, 'rebase', '--abort').catch(() => undefined)
        conflicted.add(issue)
        report.conflicts.push(branch)
        await notify(
          `Stack maintenance: rebase conflict on ${branch} (after ${parentBranch} merged). ` +
            'The branch is untouched — a person needs to rebase it by hand.',
        )
        return
      }
      if ((await git(repoDir, 'rev-parse', branch)) !== before) {
        const expected = await git(repoDir, 'rev-parse', `origin/${branch}`)
        await git(repoDir, 'push', `--force-with-lease=${branch}:${expected}`, 'origin', branch)
        report.rebased.push(issue)
      }
      if (retarget) {
        const prs = await deps.ghJsonFn<{ number: number; baseRefName: string }[]>(
          repoDir,
          'pr',
          'list',
          '--state',
          'open',
          '--head',
          branch,
          '--json',
          'number,baseRefName',
        )
        for (const pr of prs) {
          if (pr.baseRefName === defaultBase.name) continue
          await deps.ghFn(repoDir, 'pr', 'edit', String(pr.number), '--base', defaultBase.name)
          report.retargeted.push(issue)
        }
      }
      // Deeper levels rebase onto this freshly-rebased branch; their PR
      // bases keep pointing at their parent.
      for (const child of await dependentsOf(repoDir, config, issue, deps)) {
        await rebaseDependent(child, issue, `origin/${branch}`, false)
      }
    }

    // ── Merged loop PRs ─────────────────────────────────────────────────
    const merged = (
      await deps.ghJsonFn<MergedPr[]>(
        repoDir,
        'pr',
        'list',
        '--state',
        'merged',
        '--json',
        'number,headRefName,baseRefName',
        '--limit',
        '50',
      )
    )
      .map((pr) => ({ ...pr, issue: loopIssueNumber(pr.headRefName) }))
      .filter((pr): pr is MergedPr & { issue: number } => pr.issue !== null)
      .sort((a, b) => a.issue - b.issue)

    for (const pr of merged) {
      if (config.issues.tracker === 'markdown') {
        const state = await issueState(repoDir, config, pr.issue, deps)
        if (state !== 'done') {
          await relabel(repoDir, config, pr.issue, state ?? '', 'done')
          report.markedDone.push(pr.issue)
        }
      }
      for (const child of await dependentsOf(repoDir, config, pr.issue, deps)) {
        await rebaseDependent(child, pr.issue, defaultBase.ref, true)
      }
      if (await branchExists(repoDir, `origin/${pr.headRefName}`)) {
        await git(repoDir, 'push', 'origin', '--delete', pr.headRefName)
        report.deletedBranches.push(pr.headRefName)
      }
      if (await branchExists(repoDir, pr.headRefName)) {
        await git(repoDir, 'branch', '-D', pr.headRefName).catch(() => undefined)
      }
    }

    // ── Closed-unmerged loop PRs on unsteered issues ────────────────────
    const closed = (
      await deps.ghJsonFn<{ number: number; headRefName: string }[]>(
        repoDir,
        'pr',
        'list',
        '--state',
        'closed',
        '--json',
        'number,headRefName',
        '--limit',
        '50',
      )
    )
      .map((pr) => ({ ...pr, issue: loopIssueNumber(pr.headRefName) }))
      .filter(
        (pr): pr is { number: number; headRefName: string; issue: number } => pr.issue !== null,
      )
    for (const pr of closed) {
      const state = await issueState(repoDir, config, pr.issue, deps)
      if (state !== null) continue // a person (or the Loop) is already steering it
      await relabel(repoDir, config, pr.issue, '', config.issues.parked)
      report.parked.push(pr.issue)
      await notify(
        `Stack maintenance: PR for ${pr.headRefName} was closed without merging and nobody ` +
          `is steering issue #${pr.issue} — parked it for a human decision.`,
      )
    }
  } finally {
    await unlock()
  }

  return report
}

// ── Standalone entry ────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[process.argv.indexOf('--repo') + 1]
  if (!repo || repo.startsWith('--')) {
    console.error('usage: node src/maintenance.ts --repo <path>')
    process.exit(64)
  }
  const repoDir = resolve(repo)
  const config = await loadConfig(`${repoDir}/loop.config.ts`)
  const notify = async (text: string) => {
    console.log(`[notify] ${text}`)
    try {
      const telePi = await loadTelePiConfig()
      await sendTelegramMessage(telePi, text)
    } catch (error) {
      console.warn(`telegram notify failed: ${String(error)}`)
    }
  }
  const report = await maintenance({ repoDir, config, notify })
  const summary = [
    `marked done: [${report.markedDone.join(', ')}]`,
    `rebased: [${report.rebased.join(', ')}]`,
    `retargeted: [${report.retargeted.join(', ')}]`,
    `deleted: [${report.deletedBranches.join(', ')}]`,
    `parked: [${report.parked.join(', ')}]`,
    `skipped working: [${report.skippedWorking.join(', ')}]`,
    `conflicts: [${report.conflicts.join(', ')}]`,
  ]
  console.log(`maintenance: ${summary.join(' · ')}`)
  if (
    report.markedDone.length > 0 ||
    report.rebased.length > 0 ||
    report.parked.length > 0 ||
    report.conflicts.length > 0
  ) {
    await notify(`Stack maintenance (${repoDir.split('/').pop()}): ${summary.join(' · ')}`)
  }
}
