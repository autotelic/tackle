#!/usr/bin/env node
/**
 * One issue end to end, from claim to draft PR (#13). A plain script, no
 * state machine: claim the first ready issue, work Passes on a loop/<issue>
 * branch with a Checkpoint after every Session and a Receipt after every
 * Pass, and open a draft PR when the Checks pass.
 *
 * Usage: node src/run-issue.ts --repo <path> [--issue <n>] [--budget <n>]
 *
 * Exit code: 0 = draft PR opened, 1 = budget exhausted (issue parked),
 * 2 = infrastructure failure (Pause; issue stays working),
 * 3 = blocked-on-human (issue parked with the question).
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { runChecks } from './checks.ts'
import { type LoopConfig, loadConfig } from './config.ts'
import { createHumanChannel } from './human-channel.ts'
import { buildSessionPrompt } from './prompt.ts'
import { type Receipt, renderReceipt } from './receipt.ts'
import { runSession, type SessionOutcome } from './session.ts'

const execFileAsync = promisify(execFile)

function parseArgs(argv: string[]): {
  repo: string
  issue?: number
  budget?: number
  channel?: 'terminal' | 'telepi'
} {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      console.error(`bad argument near '${key ?? '<end>'}'`)
      process.exit(64)
    }
    args[key.slice(2)] = value
  }
  if (!args.repo) {
    console.error(
      'usage: node src/run-issue.ts --repo <path> [--issue <n>] [--budget <n>] [--channel terminal|telepi]',
    )
    process.exit(64)
  }
  const channel = args.channel
  if (channel !== undefined && channel !== 'terminal' && channel !== 'telepi') {
    console.error('--channel must be terminal or telepi')
    process.exit(64)
  }
  return {
    repo: resolve(args.repo),
    issue: args.issue ? Number(args.issue) : undefined,
    budget: args.budget ? Number(args.budget) : undefined,
    ...(channel ? { channel } : {}),
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function gh(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, { cwd })
  return stdout.trim()
}

async function ghJson<T>(cwd: string, ...args: string[]): Promise<T> {
  return JSON.parse(await gh(cwd, ...args)) as T
}

/** Login shell for repo commands: node and pnpm live behind fnm on the mini. */
async function sh(cwd: string, command: string): Promise<void> {
  await execFileAsync('zsh', ['-lic', command], { cwd })
}

type Issue = { number: number; title: string; body: string }

async function pickIssue(repoDir: string, config: LoopConfig, wanted?: number): Promise<Issue> {
  if (wanted !== undefined) {
    return ghJson<Issue>(repoDir, 'issue', 'view', String(wanted), '--json', 'number,title,body')
  }
  const ready = await ghJson<Issue[]>(
    repoDir,
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    config.issues.ready,
    '--json',
    'number,title,body',
    '--limit',
    '50',
  )
  const first = ready.sort((a, b) => a.number - b.number)[0]
  if (!first) {
    console.error(`no open issues labelled ${config.issues.ready}`)
    process.exit(64)
  }
  return first
}

/** Revert any protected paths the Session touched; returns what was reverted. */
async function revertProtected(worktreeDir: string, protectedPaths: string[]): Promise<string[]> {
  if (protectedPaths.length === 0) return []
  const status = await git(worktreeDir, 'status', '--porcelain', '--', ...protectedPaths)
  const touched = status
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
  if (touched.length === 0) return []
  await git(worktreeDir, 'checkout', '--', ...touched)
  return touched
}

/** Checkpoint (#8): commit and push whatever the Session left, clean or not. */
async function checkpoint(worktreeDir: string, branch: string, message: string): Promise<string> {
  await git(worktreeDir, 'add', '-A')
  const status = await git(worktreeDir, 'status', '--porcelain')
  // --no-verify: bookkeeping, not agent work (see issue-loop.ts checkpoint).
  if (status.length > 0) await git(worktreeDir, 'commit', '-m', message, '--no-verify')
  const sha = await git(worktreeDir, 'rev-parse', 'HEAD')
  await git(worktreeDir, 'push', '-u', 'origin', branch)
  return sha
}

function progressNotePath(worktreeDir: string): string {
  return join(worktreeDir, 'PROGRESS.md')
}

async function readProgressNote(worktreeDir: string): Promise<string | null> {
  try {
    return await readFile(progressNotePath(worktreeDir), 'utf8')
  } catch {
    return null
  }
}

const stamp = () => new Date().toISOString().replaceAll(/[:.]/g, '-')

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const repoDir = args.repo
  const config = await loadConfig(join(repoDir, 'loop.config.ts'))
  const budget = args.budget ?? config.budgets.passesPerIssue
  const issue = await pickIssue(repoDir, config, args.issue)
  const branch = `loop/${issue.number}`
  const worktreeDir = join(repoDir, '.treadle', 'worktrees', String(issue.number))

  console.log(`claiming #${issue.number} "${issue.title}" → ${branch}`)
  await gh(
    repoDir,
    'issue',
    'edit',
    String(issue.number),
    '--remove-label',
    config.issues.ready,
    '--add-label',
    config.issues.working,
  )

  await git(repoDir, 'fetch', 'origin')
  const baseRef = await git(repoDir, 'rev-parse', '--verify', 'origin/main').then(
    () => 'origin/main',
    () => 'main',
  )
  await git(repoDir, 'worktree', 'add', worktreeDir, '-b', branch, baseRef)

  try {
    console.log('installing dependencies in the worktree')
    await sh(worktreeDir, 'pnpm install --frozen-lockfile')

    const vision = await readFile(join(worktreeDir, 'VISION.md'), 'utf8')
    const treadleDir = join(repoDir, '.treadle')

    // Baseline: prove the harness is healthy on a fresh branch before spending
    // a Session (#8's restart re-entry does the same: run the Checks, continue
    // from the result).
    const baselineDir = join(treadleDir, `checks-issue-${issue.number}-baseline-${stamp()}`)
    console.log('running baseline checks')
    const baseline = await runChecks(config, {
      repoDir: worktreeDir,
      outDir: baselineDir,
      issue: issue.number,
      pass: 0,
    })
    if (baseline.infrastructureFailure) {
      console.error(`baseline infrastructure failure: ${baseline.infrastructureFailure.detail}`)
      return 2
    }
    if (baseline.outcome !== 'checks.passed') {
      console.error(
        `baseline checks failed on a fresh branch (frontier ${baseline.frontier}) — the harness, ` +
          'config or base branch is broken, not the issue. Not spending any budget.',
      )
      return 2
    }

    const nameWithOwner = await gh(
      repoDir,
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ).then(
      (s) => s.trim(),
      () => null,
    )
    let lastReportDir: string | null = null
    let lastReport: typeof baseline | null = null
    const human = await createHumanChannel(args.channel, () => ({
      issue: issue.number,
      ...(nameWithOwner
        ? { issueUrl: `https://github.com/${nameWithOwner}/issues/${issue.number}` }
        : {}),
      branch,
      checkSummary: lastReport ? summarize(lastReport) : 'baseline checks passed',
    }))
    const passes: { outcome: SessionOutcome; lastText: string | null }[] = []
    let previousNote: string | null = null
    // Where the branch stands, deterministically from git (#14/#15 question class).
    const branchFacts = {
      baseRef: baseRef,
      integrationDrift: config.integrationBranch
        ? await git(
            worktreeDir,
            'rev-list',
            '--count',
            `HEAD..origin/${config.integrationBranch}`,
          ).then(
            (stdout) => (Number.isFinite(Number(stdout)) ? Number(stdout) : null),
            () => null,
          )
        : null,
    }

    for (let pass = 1; pass <= budget; pass++) {
      console.log(`\n— pass ${pass} of ${budget}: session`)
      const prompt = buildSessionPrompt({
        vision,
        issue,
        progressNote: await readProgressNote(worktreeDir),
        lastReport,
        lastReportDir,
        previousSessionNote: previousNote,
        pass,
        budget,
        protectedPaths: config.protectedPaths,
        branchFacts,
      })
      const sessionLogPath = join(
        treadleDir,
        'sessions',
        `issue-${issue.number}-pass-${pass}-${stamp()}.jsonl`,
      )
      const outcome = await runSession({
        cwd: worktreeDir,
        prompt,
        maxTurns: config.budgets.maxTurnsPerSession,
        timeoutMs: config.budgets.sessionTimeoutMinutes * 60_000,
        askHumanTimeoutMs: config.budgets.askHumanTimeoutMinutes * 60_000,
        askHuman: human.askHuman,
        logPath: sessionLogPath,
        // Mid-session checks through the same deterministic runner the
        // post-pass Checks use: the agent declares, the loop executes.
        runChecks: () => {
          const reportDir = join(
            treadleDir,
            `checks-issue-${issue.number}-pass-${pass}-inflight-${stamp()}`,
          )
          return runChecks(config, {
            repoDir: worktreeDir,
            outDir: reportDir,
            issue: issue.number,
            pass,
          }).then((report) => ({ report, reportDir }))
        },
        onEvent: (event) => {
          if (event.type !== 'session.terminal') console.log(`  ${event.type}`)
        },
      })
      console.log(
        `  terminal: ${outcome.terminal}${outcome.reason ? ` — ${outcome.reason}` : ''} (${outcome.turns} turns)`,
      )
      previousNote = outcome.lastAssistantText
      passes.push({ outcome, lastText: outcome.lastAssistantText })

      const reverted = await revertProtected(worktreeDir, config.protectedPaths)
      if (reverted.length > 0) console.log(`  reverted protected paths: ${reverted.join(', ')}`)
      const sha = await checkpoint(
        worktreeDir,
        branch,
        `treadle: pass ${pass} checkpoint for #${issue.number} (${outcome.terminal})`,
      )
      console.log(`  checkpoint ${sha.slice(0, 8)}`)

      if (outcome.terminal === 'blocked-on-human') {
        const receipt: Receipt = {
          issue: issue.number,
          pass,
          budget,
          terminal: outcome.terminal,
          reason: outcome.reason,
          turns: outcome.turns,
          sessionLogPath,
          checkpoint: sha,
          checks: null,
        }
        await gh(
          repoDir,
          'issue',
          'comment',
          String(issue.number),
          '--body',
          renderReceipt(receipt),
        )
        await gh(
          repoDir,
          'issue',
          'comment',
          String(issue.number),
          '--body',
          `**Question from the Session:**\n\n${outcome.reason ?? ''}\n\n` +
            'Answer with /treadle whenever you like — the question stays open, and the Loop ' +
            'picks the issue back up when your answer lands.',
        )
        await park(repoDir, config, issue.number)
        console.log('blocked-on-human: question posted and stays open, issue parked')
        return 3
      }

      console.log(`— pass ${pass} of ${budget}: checks`)
      lastReportDir = join(treadleDir, `checks-issue-${issue.number}-pass-${pass}-${stamp()}`)
      lastReport = await runChecks(config, {
        repoDir: worktreeDir,
        outDir: lastReportDir,
        issue: issue.number,
        pass,
      })

      const receipt: Receipt = {
        issue: issue.number,
        pass,
        budget,
        terminal: outcome.terminal,
        reason: outcome.reason,
        turns: outcome.turns,
        sessionLogPath,
        checkpoint: sha,
        checks: lastReport.infrastructureFailure
          ? {
              infrastructureFailure: `${lastReport.infrastructureFailure.kind}: ${lastReport.infrastructureFailure.detail}`,
              reportDir: lastReportDir,
            }
          : {
              outcome: lastReport.outcome as 'checks.passed' | 'checks.failed',
              frontier: lastReport.frontier,
              failureSet: lastReport.failureSet,
              reportDir: lastReportDir,
            },
      }
      await gh(repoDir, 'issue', 'comment', String(issue.number), '--body', renderReceipt(receipt))

      if (lastReport.infrastructureFailure) {
        console.error(`infrastructure failure: ${lastReport.infrastructureFailure.detail}`)
        return 2
      }
      if (lastReport.outcome === 'checks.passed') {
        console.log('checks.passed — opening draft PR')
        const note = (await readProgressNote(worktreeDir)) ?? '# Progress\n'
        await writeFile(
          progressNotePath(worktreeDir),
          `${note.trimEnd()}\n\n- ${new Date().toISOString().slice(0, 10)}: checks.passed on pass ${pass}; draft PR opened.\n`,
        )
        await checkpoint(worktreeDir, branch, `treadle: progress note for #${issue.number}`)
        await openDraftPr(repoDir, branch, issue, pass)
        return 0
      }
      console.log(`  checks.failed — frontier ${lastReport.frontier}`)
    }

    // Budget exhausted: park with the #9 summary.
    const history = passes
      .map((p, i) => {
        const tried = p.lastText ? p.lastText.slice(0, 300) : '(no final message)'
        return `- Pass ${i + 1}: ${p.outcome.terminal} — ${tried}`
      })
      .join('\n')
    await gh(
      repoDir,
      'issue',
      'comment',
      String(issue.number),
      '--body',
      `**Parked after ${budget} Passes.**\n\n${history}\n\nLast Failure set is in the latest Receipt above.`,
    )
    await park(repoDir, config, issue.number)
    console.log('budget exhausted: issue parked')
    return 1
  } finally {
    await git(repoDir, 'worktree', 'remove', worktreeDir, '--force').then(
      () => {},
      () => {},
    )
  }
}

function summarize(report: {
  outcome: string | null
  frontier: number
  failureSet: { check: string; test?: string }[]
}): string {
  const entries = report.failureSet
    .slice(0, 3)
    .map((entry) => (entry.test ? `${entry.check} › ${entry.test}` : entry.check))
  const base = `${report.outcome}, frontier ${report.frontier}`
  return entries.length > 0 ? `${base} — ${entries.join('; ')}` : base
}

async function park(repoDir: string, config: LoopConfig, issueNumber: number): Promise<void> {
  await gh(
    repoDir,
    'issue',
    'edit',
    String(issueNumber),
    '--remove-label',
    config.issues.working,
    '--add-label',
    config.issues.parked,
  )
}

async function openDraftPr(
  repoDir: string,
  branch: string,
  issue: Issue,
  pass: number,
): Promise<void> {
  const existing = await ghJson<unknown[]>(
    repoDir,
    'pr',
    'list',
    '--head',
    branch,
    '--json',
    'number',
  )
  if (existing.length > 0) {
    console.log(`draft PR for ${branch} already exists`)
    return
  }
  await gh(
    repoDir,
    'pr',
    'create',
    '--draft',
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    `${issue.title} (#${issue.number})`,
    '--body',
    `Closes #${issue.number}\n\nBuilt by Treadle in ${pass} pass${pass === 1 ? '' : 'es'}. ` +
      'Receipts (one per pass, with the check results) are in the issue comments.',
  )
  console.log('draft PR opened')
}

process.exit(await main())
