import type { CheckReport } from './report.ts'

/**
 * Build the prompt for one Session (#13): VISION.md, the issue, the progress
 * note, and the last check report — trimmed, with the paths to the full logs
 * so the agent can read them itself.
 */

export type SessionPromptInput = {
  vision: string
  issue: { number: number; title: string; body: string }
  /** PROGRESS.md content, or null when it doesn't exist yet. */
  progressNote: string | null
  /** The previous Pass's check report; null only before the first ever Pass. */
  lastReport: CheckReport | null
  /** Absolute path of the previous report's directory (logs/ lives inside). */
  lastReportDir: string | null
  /** What the previous Session's last message said, trimmed. */
  previousSessionNote: string | null
  /** Earlier questions to the human and their answers (#8). */
  qa?: { question: string; answer?: string }[]
  pass: number
  budget: number
  protectedPaths: string[]
  /**
   * Deterministic git facts about where the branch stands, computed by the
   * caller from git — so the Session never burns turns discovering them and
   * never asks the human about base staleness (the #14/#15 question class).
   */
  branchFacts?: {
    baseRef: string
    /** Commits on origin/<integrationBranch> not reachable from HEAD; null without an integration branch. */
    integrationDrift: number | null
  }
}

const MAX_DETAIL = 300
const MAX_PREVIOUS_NOTE = 1000

export function buildSessionPrompt(input: SessionPromptInput): string {
  const sections: string[] = []

  sections.push(
    'You are one work session of Treadle, an automated loop working through the issues of ' +
      'this repository. The loop runs the Checks itself after you finish and decides whether ' +
      'the work is good, so you never grade yourself. Do not run `gh` or `git push`. ' +
      'To see where you stand mid-session, call the run_checks tool — never run test suites ' +
      'in bash. If you need a judgement call from a person, call the ask_human tool.',
  )

  sections.push(`# Vision\n\n${input.vision.trim()}`)

  sections.push(
    `# Your issue — #${input.issue.number}: ${input.issue.title}\n\n${input.issue.body.trim()}`,
  )

  const progressBody =
    input.progressNote === null
      ? 'No PROGRESS.md exists yet. Create one at the repository root.'
      : `PROGRESS.md so far:\n\n${input.progressNote.trim()}`
  sections.push(
    `# Progress note\n\n${progressBody}\n\nKeep PROGRESS.md short and accurate: what works, ` +
      "what's left, anything the next session must know. It travels with the branch and is " +
      "the next session's memory.",
  )

  const reportLines: string[] = []
  if (input.lastReport === null) {
    reportLines.push(
      'This is the first Pass. The baseline Checks on a fresh branch pass; everything you ' +
        'break from here is yours to fix.',
    )
  } else {
    const report = input.lastReport
    reportLines.push(
      `This is Pass ${input.pass} of ${input.budget}. The last Pass's Checks: ${report.outcome}, ` +
        `frontier ${report.frontier}.`,
    )
    if (report.failureSet.length > 0) {
      reportLines.push('Failure set:')
      for (const entry of report.failureSet) {
        const where = entry.test ? `${entry.check} › ${entry.test}` : entry.check
        const detail = entry.detail ? ` — ${entry.detail.slice(0, MAX_DETAIL)}` : ''
        reportLines.push(`- ${where}${detail}`)
      }
    }
    if (input.lastReportDir !== null) {
      reportLines.push(
        `The full report is at ${input.lastReportDir}/checks.json and the full logs at ` +
          `${input.lastReportDir}/logs/ (one per Check, plus app.log). Read them before you ` +
          'start changing things.',
      )
    }
  }
  if (input.branchFacts) {
    const facts = input.branchFacts
    const lines =
      facts.integrationDrift === null
        ? [
            `Your branch was cut from ${facts.baseRef}.`,
            'The loop rebases branches between passes when the base moves; never merge or rebase yourself.',
          ]
        : facts.integrationDrift > 0
          ? [
              `Your branch was cut from ${facts.baseRef}; the integration branch has moved ${facts.integrationDrift} commits ahead of it.`,
              "Work that depends on those commits waits for the loop's next rebase (between passes). Never merge or rebase yourself — say in PROGRESS.md what you are waiting on, and continue with what does not depend on it.",
            ]
          : [
              `Your branch was cut from ${facts.baseRef} and is current with the integration branch.`,
              'The loop rebases branches between passes; never merge or rebase yourself.',
            ]
    sections.push(`# Where your branch stands\n\n${lines.join('\n')}`)
  }
  if (input.previousSessionNote !== null) {
    reportLines.push(
      "The previous session's last message, for continuity:\n\n" +
        input.previousSessionNote.slice(0, MAX_PREVIOUS_NOTE),
    )
  }
  sections.push(`# Where this Pass starts\n\n${reportLines.join('\n\n')}`)

  if (input.qa && input.qa.length > 0) {
    const qaLines = input.qa.map((pair) =>
      pair.answer !== undefined
        ? `- Q: ${pair.question}\n  A: ${pair.answer}`
        : `- Q: ${pair.question}\n  (still unanswered)`,
    )
    sections.push(
      `# Questions and answers so far\n\n${qaLines.join('\n')}\n\n` +
        "Treat the latest answer as the human's current judgement; earlier ones may be stale.",
    )
  }

  const protectedList = input.protectedPaths.map((p) => `\`${p}\``).join(', ')
  sections.push(
    '# Rules\n\n' +
      "- Implement the issue's acceptance criteria, and cover every criterion with at least " +
      'one test that would fail without the change: unit tests via app.inject for API ' +
      'behaviour, e2e tests at APP_URL for anything a person sees in the browser.\n' +
      `- Never touch the protected paths: ${protectedList}. The loop reverts them before it commits.\n` +
      "- Don't weaken or delete an existing test to make the Checks pass; if a test looks " +
      'wrong, call ask_human.\n' +
      '- Never run test suites yourself in bash. Call the run_checks tool instead: it runs the ' +
      "repository Check suites through the loop's own deterministic runner — the canonical " +
      'invocation, the right env and ports, the structured failure set. Bash stays for ' +
      'inspecting files, logs and git state. If run_checks is refused or its budget is gone, ' +
      'just finish your work: the loop runs the full Checks after your session either way.\n' +
      '- Never start the app or a database stack yourself (no TEST_DB_PORT/TEST_REDIS_PORT ' +
      'ceremonies, no server processes left running): the loop refuses to run its own Checks ' +
      'while the app port is busy. run_checks owns all of that; if it reports an ' +
      'infrastructure failure, stop and describe what you saw in your final message.',
  )

  return `${sections.join('\n\n')}\n`
}
