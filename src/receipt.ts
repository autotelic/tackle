import type { FailureSetEntry } from './report.ts'

/**
 * A Receipt: the Loop's record of one Pass, written as an issue comment (#8).
 * Readable text plus a hidden JSON block the Loop parses after a restart.
 */

export type Receipt = {
  issue: number
  pass: number
  budget: number
  /** The Session's Terminal state. */
  terminal: string
  reason?: string
  turns: number
  sessionLogPath: string
  /** The Checkpoint commit the Receipt names. */
  checkpoint: string
  checks:
    | {
        outcome: 'checks.passed' | 'checks.failed'
        frontier: number
        failureSet: FailureSetEntry[]
        reportDir: string
      }
    | { infrastructureFailure: string; reportDir: string }
    | null
}

export function renderReceipt(receipt: Receipt): string {
  const lines: string[] = []
  lines.push(
    `**Receipt — Pass ${receipt.pass} of ${receipt.budget}** (Checkpoint \`${receipt.checkpoint.slice(0, 8)}\`)`,
  )
  lines.push('')
  const reason = receipt.reason ? ` — ${receipt.reason}` : ''
  lines.push(`- Session: **${receipt.terminal}**${reason} (${receipt.turns} turns)`)
  if (receipt.checks === null) {
    lines.push('- Checks: not run (Session blocked-on-human)')
  } else if ('infrastructureFailure' in receipt.checks) {
    lines.push(`- Checks: **infrastructure failure** — ${receipt.checks.infrastructureFailure}`)
  } else {
    lines.push(`- Checks: **${receipt.checks.outcome}** — frontier ${receipt.checks.frontier}`)
    for (const entry of receipt.checks.failureSet) {
      const where = entry.test ? `${entry.check} › ${entry.test}` : entry.check
      lines.push(`  - ${where}`)
    }
  }
  lines.push('')
  lines.push('<!-- treadle:receipt')
  lines.push(JSON.stringify(receipt, null, 2))
  lines.push('-->')
  return `${lines.join('\n')}\n`
}

/** Parse the hidden JSON block back out of a Receipt comment. */
export function parseReceipt(body: string): Receipt | null {
  const match = body.match(/<!-- treadle:receipt\s*(\{.*?\})\s*-->/s)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as Receipt
  } catch {
    return null
  }
}
