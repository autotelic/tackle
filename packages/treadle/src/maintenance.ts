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
 * - Feature-branch shift (ADR-0003): with `integrationBranch` configured, the
 *   branch is the staging area and the Loop merges every green PR into it
 *   (squash, CI green,
 *   stateless issue) and opens the human review PR (branch → default branch)
 *   once, on the first merge. Conflict nags dedupe across passes.
 *
 * Branches the loop is working right now (`working` state) are never
 * rebased; their turn comes when they finish or park. Conflicts never touch
 * the branch — they're notifications for a person.
 *
 * Usage: node src/maintenance.ts --repo <path>
 *
 * Exit code 0 always: conflicts and skips are reported, not process failures.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type LoopConfig, loadConfig } from './config.ts'
import { branchExists, gh, ghJson, git } from './loop/git-exec.ts'
import { commitAndPush, type IssueFile, readIssueFiles } from './loop/markdown-tracker.ts'
import { rebaseResolvingScratch } from './loop/rebase.ts'
import { takeLock } from './loop/reconcile.ts'
import { parseBaseFromBody, relabel, resolveBaseRef } from './loop/tracker.ts'
import { loadTelePiConfig, sendTelegramMessage } from './telepi.ts'

export type MaintenanceReport = {
  autoMerged: (number | string)[]
  reviewPrUrl: string | null
  markedDone: number[]
  rebased: number[]
  retargeted: number[]
  deletedBranches: string[]
  parked: number[]
  skippedWorking: number[]
  skippedMissing: number[]
  conflicts: string[]
  errors: string[]
}

function emptyReport(): MaintenanceReport {
  return {
    autoMerged: [],
    reviewPrUrl: null,
    markedDone: [],
    rebased: [],
    retargeted: [],
    deletedBranches: [],
    parked: [],
    skippedWorking: [],
    skippedMissing: [],
    conflicts: [],
    errors: [],
  }
}

/** Injectable seams for tests: everything GitHub goes through these. */
export type MaintenanceDeps = {
  ghFn: typeof gh
  ghJsonFn: typeof ghJson
}

type MergedPr = { number: number; headRefName: string; baseRefName: string; mergedAt: string }

type OpenPr = {
  number: number
  headRefName: string
  baseRefName: string
  title: string
  isDraft: boolean
  mergeable: string
  mergeStateStatus: string
}

/**
 * The watermark: maintenance never acts on PR history from before its own
 * first run against this repo+tracker. Without it, a repo with pre-existing
 * loop/* PRs (from another tracker, another numbering, or another era) gets
 * its old merges mapped onto unrelated issues — marking them done and
 * deleting branches out from under live PRs (the smoke run did exactly
 * this). A lost watermark re-initializes to "skip history", which is the
 * safe default. Markdown: a file in the synced tracker repo. GitHub: a
 * clone-local file under .treadle/.
 */
async function readWatermark(repoDir: string, config: LoopConfig): Promise<Date | null> {
  try {
    const text = await readFile(watermarkPath(repoDir, config), 'utf8')
    const date = new Date(text.trim())
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

async function writeWatermark(repoDir: string, config: LoopConfig, when: Date): Promise<void> {
  const path = watermarkPath(repoDir, config)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${when.toISOString()}\n`)
  if (config.issues.tracker === 'markdown') {
    await commitAndPush(config.issues.dir as string, 'treadle: maintenance watermark')
  }
}

function watermarkPath(repoDir: string, config: LoopConfig): string {
  return config.issues.tracker === 'markdown'
    ? join(config.issues.dir as string, '.treadle-maintenance-watermark')
    : join(repoDir, '.treadle', 'maintenance-watermark')
}

/**
 * Conflict-nag state (ADR-0003): branches currently known to conflict, one
 * per line. A branch pages a person the first pass it is seen conflicted;
 * repeats stay silent until it resolves and conflicts again.
 */
function conflictsPath(repoDir: string, config: LoopConfig): string {
  return config.issues.tracker === 'markdown'
    ? join(config.issues.dir as string, '.treadle-maintenance-conflicts')
    : join(repoDir, '.treadle', 'maintenance-conflicts')
}

async function readConflicts(repoDir: string, config: LoopConfig): Promise<Set<string>> {
  try {
    const text = await readFile(conflictsPath(repoDir, config), 'utf8')
    return new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
  } catch {
    return new Set()
  }
}

async function writeConflicts(
  repoDir: string,
  config: LoopConfig,
  branches: Set<string>,
): Promise<void> {
  const path = conflictsPath(repoDir, config)
  if (branches.size === 0) await rm(path, { force: true })
  else await writeFile(path, `${[...branches].sort().join('\n')}\n`)
  if (config.issues.tracker === 'markdown') {
    await commitAndPush(config.issues.dir as string, 'treadle: maintenance conflict state')
  }
}

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
    // ADR-0003: with an integration branch configured, the default base —
    // what dependent branches rebase onto and PRs retarget to after a merge
    // — is that branch, not the repo's default branch.
    const defaultBase = await resolveBaseRef(
      repoDir,
      { number: 0, title: '', body: '' },
      config.integrationBranch,
    )
    await git(repoDir, 'fetch', 'origin', '--prune')

    const conflicted = new Set<number>()
    // Issues whose own PR merged this pass: their branches collapse with
    // their base and get deleted below — never rebase them.
    const mergedIssues = new Set<number>()

    // Conflict nags dedupe across passes (ADR-0003): the first pass a branch
    // is seen conflicted it pages a person; repeats stay silent until it
    // resolves and conflicts again. The set is persisted below, only when
    // changed.
    const previouslyConflicted = await readConflicts(repoDir, config)
    const conflictedNow = new Set<string>()
    const noteConflict = async (branch: string, message: string): Promise<void> => {
      conflictedNow.add(branch)
      if (previouslyConflicted.has(branch)) return
      await notify(message)
    }

    const rebaseDependent = async (
      issue: number,
      parent: number,
      newBase: string,
      retarget: boolean,
    ): Promise<void> => {
      if (conflicted.has(parent) || mergedIssues.has(issue)) return
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
      // The rebase runs in a throwaway worktree: the main checkout's state
      // (a modified config, a checked-out branch) must never matter to it.
      const tmpWorktree = join(repoDir, '.treadle', 'maintenance-worktrees', String(issue))
      await git(repoDir, 'worktree', 'remove', tmpWorktree, '--force').catch(() => undefined)
      try {
        await git(repoDir, 'worktree', 'add', tmpWorktree, branch)
        await git(tmpWorktree, 'rebase', '--onto', newBase, upstream)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        await git(tmpWorktree, 'rebase', '--abort').catch(() => undefined)
        conflicted.add(issue)
        report.conflicts.push(branch)
        await noteConflict(
          branch,
          `Stack maintenance: rebase conflict on ${branch} (after ${parentBranch} merged). ` +
            `The branch is untouched. ${reason}`,
        )
        return
      } finally {
        await git(repoDir, 'worktree', 'remove', tmpWorktree, '--force').catch(() => undefined)
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

    // ── Auto-merge (ADR-0003, the feature-branch shift) ───────────────
    // With integrationBranch configured the branch is the staging area and
    // the Loop is the merger for EVERYTHING targeting it — its own loop/*
    // PRs and hand-authored ones alike (Ed's rule, 2026-11-14: humans
    // review once, at the end). Squash, CI green, non-draft. For loop/*
    // PRs the tracker gates apply (the issue stateless — the open PR is
    // the done marker — and a stacked child waits for its parent); hand
    // branches have no tracker linkage and merge on green alone. The
    // merged-PR processing below runs in the same pass for loop/*: the
    // issue goes done, dependents rebase onto the branch and retarget. The
    // human review PR (branch → default branch) is opened once, on the
    // first merge; the Loop never merges it.
    if (config.integrationBranch) {
      const integrationBranch = config.integrationBranch
      try {
        const open = await deps.ghJsonFn<OpenPr[]>(
          repoDir,
          'pr',
          'list',
          '--state',
          'open',
          '--json',
          'number,headRefName,baseRefName,title,isDraft,mergeable,mergeStateStatus',
          '--limit',
          '100',
        )
        const candidates = open
          .filter((pr) => pr.baseRefName === integrationBranch)
          .map((pr) => ({ pr, issue: loopIssueNumber(pr.headRefName) }))
        // A PR conflicted with the integration branch: rebase it here rather
        // than paging a person. Only a branch a session is actively working on
        // is untouchable, and only a conflict this engine cannot resolve (one
        // outside its own scratch files) still reaches a human.
        for (const { pr, issue } of candidates) {
          if (pr.mergeable !== 'CONFLICTING' && pr.mergeStateStatus !== 'DIRTY') continue
          const branch = pr.headRefName
          const ref = issue === null ? branch : `${branch} (issue #${issue})`
          if (issue !== null) {
            const state = await issueState(repoDir, config, issue, deps).catch(() => null)
            if (state === config.issues.working) {
              report.skippedWorking.push(issue)
              continue
            }
          }
          if (!(await branchExists(repoDir, `origin/${branch}`))) {
            await noteConflict(
              branch,
              `Stack maintenance: ${ref} conflicts with ${integrationBranch} and has no branch on ` +
                'origin — a person needs to look at it.',
            )
            continue
          }
          const tmpWorktree = join(repoDir, '.treadle', 'maintenance-worktrees', `pr-${pr.number}`)
          await git(repoDir, 'worktree', 'remove', tmpWorktree, '--force').catch(() => undefined)
          let resolved = true
          let conflictReason: string | null = null
          const expected = await git(repoDir, 'rev-parse', `origin/${branch}`)
          try {
            await git(repoDir, 'worktree', 'add', '--detach', tmpWorktree, `origin/${branch}`)
            await rebaseResolvingScratch(tmpWorktree, `origin/${integrationBranch}`, {
              generatedPaths: config.generatedPaths ?? [],
            })
            await git(
              tmpWorktree,
              'push',
              `--force-with-lease=${branch}:${expected}`,
              'origin',
              `HEAD:${branch}`,
            )
          } catch (error) {
            resolved = false
            conflictReason = error instanceof Error ? error.message : String(error)
            await git(tmpWorktree, 'rebase', '--abort').catch(() => undefined)
          } finally {
            await git(repoDir, 'worktree', 'remove', tmpWorktree, '--force').catch(() => undefined)
          }
          if (resolved) {
            if (issue !== null) report.rebased.push(issue)
            await notify(
              `Stack maintenance: rebased ${ref} onto ${integrationBranch} (a conflict in engine ` +
                'scratch files only). No action needed.',
            )
            continue
          }
          report.conflicts.push(branch)
          await noteConflict(
            branch,
            `Stack maintenance: ${ref} conflicts with ${integrationBranch} and the engine will not ` +
              'guess at code. ' +
              (conflictReason ?? 'Resolve it and push, or close the PR.'),
          )
        }
        let issueFiles: IssueFile[] | null = null
        // The issue's state gates loop/* merges: 'missing' = the tracker
        // doesn't know this loop/<n> (another era's branch) — never touch
        // it; null = stateless, the done marker. Hand branches skip this.
        const stateOf = async (issue: number): Promise<string | null | 'missing'> => {
          if (config.issues.tracker !== 'markdown') {
            return issueState(repoDir, config, issue, deps).catch(() => 'missing')
          }
          issueFiles ??= await readIssueFiles(config.issues.dir as string)
          const file = issueFiles.find((f) => f.number === issue)
          return file === undefined ? 'missing' : (file.state ?? null)
        }
        // A stacked child (numeric base:) may auto-merge only after its
        // parent's PR has merged (parent state done): the child's diff
        // contains the parent's work, so merging the child first would land
        // the parent's changes under the child's PR and leave the parent's
        // PR an empty diff nobody merges.
        const parentDone = async (issue: number): Promise<boolean> => {
          if (config.issues.tracker === 'markdown') {
            issueFiles ??= await readIssueFiles(config.issues.dir as string)
            const file = issueFiles.find((f) => f.number === issue)
            if (file === undefined) return false
            const raw = file.base
            const parent =
              typeof raw === 'number'
                ? raw
                : typeof raw === 'string' && /^\d+$/.test(raw.trim())
                  ? Number.parseInt(raw.trim(), 10)
                  : undefined
            if (parent === undefined) return true
            return issueFiles.find((f) => f.number === parent)?.state === 'done'
          }
          const view = await deps
            .ghJsonFn<{ body: string }>(repoDir, 'issue', 'view', String(issue), '--json', 'body')
            .catch(() => null)
          if (view === null) return false
          const base = parseBaseFromBody(view.body)
          const parent =
            typeof base === 'number'
              ? base
              : typeof base === 'string' && /^\d+$/.test(base)
                ? Number.parseInt(base, 10)
                : undefined
          if (parent === undefined) return true
          const state = await deps
            .ghJsonFn<{ state: string }>(
              repoDir,
              'issue',
              'view',
              String(parent),
              '--json',
              'state',
            )
            .then((i) => i.state)
            .catch(() => null)
          return state === 'CLOSED'
        }
        const green: { pr: OpenPr; issue: number | null }[] = []
        for (const { pr, issue } of candidates) {
          try {
            if (
              pr.isDraft !== false ||
              pr.mergeable !== 'MERGEABLE' ||
              pr.mergeStateStatus !== 'CLEAN'
            )
              continue
            if (issue !== null) {
              if ((await stateOf(issue)) !== null) continue
              if (!(await parentDone(issue))) continue
            }
            green.push({ pr, issue })
          } catch (error) {
            report.errors.push(
              `auto-merge eligibility ${pr.headRefName}: ` +
                (error instanceof Error ? error.message : String(error)),
            )
          }
        }
        // Tracker-tracked work first (lowest issue number), then hand
        // branches by PR number.
        green.sort(
          (a, b) =>
            (a.issue ?? Number.MAX_SAFE_INTEGER) - (b.issue ?? Number.MAX_SAFE_INTEGER) ||
            a.pr.number - b.pr.number,
        )
        let mergedCount = 0
        for (const { pr, issue } of green) {
          try {
            await deps.ghFn(
              repoDir,
              'pr',
              'merge',
              String(pr.number),
              '--squash',
              '--subject',
              pr.title,
              '--body',
              '',
            )
            report.autoMerged.push(issue ?? pr.headRefName)
            mergedCount += 1
            await notify(`Treadle merged #${pr.number} (${pr.title}) into ${integrationBranch}.`)
            // A hand branch has no tracker linkage, so the merged-PR
            // processing below won't clean it up — delete it here, unless
            // another open PR still uses it as a base (stacked hand work).
            if (issue === null) {
              const based = await deps.ghJsonFn<{ number: number }[]>(
                repoDir,
                'pr',
                'list',
                '--state',
                'open',
                '--base',
                pr.headRefName,
                '--json',
                'number',
                '--limit',
                '1',
              )
              if (based.length === 0) {
                if (await branchExists(repoDir, `origin/${pr.headRefName}`)) {
                  await git(repoDir, 'push', 'origin', '--delete', pr.headRefName)
                }
                if (await branchExists(repoDir, pr.headRefName)) {
                  await git(repoDir, 'branch', '-D', pr.headRefName).catch(() => undefined)
                }
              }
            }
          } catch (error) {
            report.errors.push(
              `${pr.headRefName}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        // The human review PR: opened once, on the first merge into the
        // branch. Closing or merging it never re-opens it.
        if (mergedCount > 0) {
          const existing = await deps.ghJsonFn<{ number: number }[]>(
            repoDir,
            'pr',
            'list',
            '--state',
            'all',
            '--head',
            integrationBranch,
            '--json',
            'number',
            '--limit',
            '1',
          )
          if (existing.length === 0) {
            const reviewTarget = await resolveBaseRef(repoDir, { number: 0, title: '', body: '' })
            const url = await deps.ghFn(
              repoDir,
              'pr',
              'create',
              '--base',
              reviewTarget.name,
              '--head',
              integrationBranch,
              '--title',
              `Treadle integration branch → ${reviewTarget.name}`,
              '--body',
              `Auto-managed (treadle ADR-0003): Treadle squash-merges every green ` +
                `\`PRs\` into \`${integrationBranch}\` as they go green. Review this ` +
                `PR into \`${reviewTarget.name}\` once at the end — the Loop never merges it.`,
            )
            report.reviewPrUrl = url.length > 0 ? url : null
            if (report.reviewPrUrl !== null) {
              await notify(`Treadle opened the review PR: ${report.reviewPrUrl}`)
            }
          }
        }
      } catch (error) {
        report.errors.push(`auto-merge: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // ── Merged loop PRs (only those after the watermark) ───────────────
    const watermark = await readWatermark(repoDir, config)
    const knownIssues =
      config.issues.tracker === 'markdown'
        ? new Set((await readIssueFiles(config.issues.dir as string)).map((f) => f.number))
        : null
    const mergedRaw = await deps.ghJsonFn<MergedPr[]>(
      repoDir,
      'pr',
      'list',
      '--state',
      'merged',
      '--json',
      'number,headRefName,baseRefName,mergedAt',
      '--limit',
      '50',
    )
    const latestMerge = mergedRaw
      .map((pr) => new Date(pr.mergedAt).getTime())
      .reduce((a, b) => Math.max(a, b), 0)
    if (watermark === null) {
      // First ever run: record the line and act on nothing before it.
      await writeWatermark(repoDir, config, new Date(Math.max(latestMerge, Date.now())))
    }
    const merged = mergedRaw
      .map((pr) => ({ ...pr, issue: loopIssueNumber(pr.headRefName) }))
      .filter((pr): pr is MergedPr & { issue: number } => pr.issue !== null)
      // >=, not >: on a first-ever run the watermark initializes to the
      // auto-merge moment, and a PR merged in that same step must still be
      // processed this pass (the merged list is fetched after auto-merge).
      .filter((pr) => watermark !== null && new Date(pr.mergedAt) >= watermark)
      .sort((a, b) => a.issue - b.issue)
    for (const pr of merged) mergedIssues.add(pr.issue)

    for (const pr of merged) {
      try {
        if (knownIssues !== null && !knownIssues.has(pr.issue)) {
          // A merged loop/<n> the tracker doesn't know: another era's branch.
          report.skippedMissing.push(pr.issue)
          continue
        }
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
        // Guard: never delete a branch that has a live PR on it, as head
        // (a new PR opened on it after the merge) or as base (deleting a
        // base branch auto-closes the PRs targeting it — the smoke run
        // lost one each way).
        const [headPrs, basePrs] = await Promise.all([
          deps.ghJsonFn<{ number: number }[]>(
            repoDir,
            'pr',
            'list',
            '--state',
            'open',
            '--head',
            pr.headRefName,
            '--json',
            'number',
          ),
          deps.ghJsonFn<{ number: number }[]>(
            repoDir,
            'pr',
            'list',
            '--state',
            'open',
            '--base',
            pr.headRefName,
            '--json',
            'number',
          ),
        ])
        if (headPrs.length === 0 && basePrs.length === 0) {
          if (await branchExists(repoDir, `origin/${pr.headRefName}`)) {
            await git(repoDir, 'push', 'origin', '--delete', pr.headRefName)
            report.deletedBranches.push(pr.headRefName)
          }
          if (await branchExists(repoDir, pr.headRefName)) {
            await git(repoDir, 'branch', '-D', pr.headRefName).catch(() => undefined)
          }
        }
      } catch (error) {
        // One bad PR never aborts the pass.
        report.errors.push(
          `${pr.headRefName}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // ── Closed-unmerged loop PRs on unsteered issues ────────────────────
    const closed = (
      await deps.ghJsonFn<{ number: number; headRefName: string; closedAt: string }[]>(
        repoDir,
        'pr',
        'list',
        '--state',
        'closed',
        '--json',
        'number,headRefName,closedAt',
        '--limit',
        '50',
      )
    )
      .map((pr) => ({ ...pr, issue: loopIssueNumber(pr.headRefName) }))
      .filter(
        (pr): pr is { number: number; headRefName: string; closedAt: string; issue: number } =>
          pr.issue !== null,
      )
      .filter((pr) => watermark !== null && new Date(pr.closedAt) >= watermark)
    for (const pr of closed) {
      try {
        if (knownIssues !== null && !knownIssues.has(pr.issue)) {
          report.skippedMissing.push(pr.issue)
          continue
        }
        const state = await issueState(repoDir, config, pr.issue, deps)
        if (state !== null) continue // a person (or the Loop) is already steering it
        await relabel(repoDir, config, pr.issue, '', config.issues.parked)
        report.parked.push(pr.issue)
        await notify(
          `Stack maintenance: PR for ${pr.headRefName} was closed without merging and nobody ` +
            `is steering issue #${pr.issue} — parked it for a human decision.`,
        )
      } catch (error) {
        report.errors.push(
          `${pr.headRefName}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    // Persist the conflict-nag state, but only when it changed — a branch
    // that stays conflicted must not commit-and-push every pass.
    const conflictStateChanged =
      conflictedNow.size !== previouslyConflicted.size ||
      [...conflictedNow].some((branch) => !previouslyConflicted.has(branch))
    if (conflictStateChanged) await writeConflicts(repoDir, config, conflictedNow)
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
    `auto-merged: [${report.autoMerged.join(', ')}]`,
    `marked done: [${report.markedDone.join(', ')}]`,
    `rebased: [${report.rebased.join(', ')}]`,
    `retargeted: [${report.retargeted.join(', ')}]`,
    `deleted: [${report.deletedBranches.join(', ')}]`,
    `parked: [${report.parked.join(', ')}]`,
    `skipped working: [${report.skippedWorking.join(', ')}]`,
    `skipped missing: [${report.skippedMissing.join(', ')}]`,
    `conflicts: [${report.conflicts.join(', ')}]`,
    `errors: [${report.errors.join(' | ')}]`,
  ]
  console.log(`maintenance: ${summary.join(' · ')}`)
  if (
    report.autoMerged.length > 0 ||
    report.markedDone.length > 0 ||
    report.rebased.length > 0 ||
    report.parked.length > 0 ||
    report.conflicts.length > 0 ||
    report.errors.length > 0
  ) {
    await notify(`Stack maintenance (${repoDir.split('/').pop()}): ${summary.join(' · ')}`)
  }
}
