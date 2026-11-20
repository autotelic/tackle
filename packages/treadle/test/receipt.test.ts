import { describe, expect, it } from 'vitest'
import { parseReceipt, type Receipt, renderReceipt } from '../src/receipt.ts'

const receipt: Receipt = {
  issue: 1,
  pass: 2,
  budget: 3,
  terminal: 'completed',
  turns: 12,
  sessionLogPath: '/repo/.treadle/sessions/issue-1-pass-2.jsonl',
  checkpoint: 'abc123def456',
  checks: {
    outcome: 'checks.failed',
    frontier: 2,
    failureSet: [
      { check: 'unit', test: 'POST /items creates an item', detail: 'boom' },
      { check: 'typecheck', detail: 'exit code 2' },
    ],
    reportDir: '/repo/.treadle/checks-issue-1-pass-2',
  },
}

describe('renderReceipt', () => {
  it('renders readable text with the checkpoint, terminal state and failure set', () => {
    const body = renderReceipt(receipt)
    expect(body).toContain('**Receipt — Pass 2 of 3** (Checkpoint `abc123de`)')
    expect(body).toContain('Session: **completed** (12 turns)')
    expect(body).toContain('Checks: **checks.failed** — frontier 2')
    expect(body).toContain('unit › POST /items creates an item')
  })

  it('renders blocked and infrastructure-failure variants', () => {
    const blocked = renderReceipt({
      ...receipt,
      terminal: 'blocked-on-human',
      reason: 'deploy?',
      checks: null,
    })
    expect(blocked).toContain('blocked-on-human')
    expect(blocked).toContain('deploy?')
    expect(blocked).toContain('not run')

    const infra = renderReceipt({
      ...receipt,
      checks: { infrastructureFailure: 'port-busy: 4317 in use', reportDir: '/x' },
    })
    expect(infra).toContain('**infrastructure failure** — port-busy')
  })
})

describe('parseReceipt', () => {
  it('round-trips the hidden JSON block', () => {
    expect(parseReceipt(renderReceipt(receipt))).toEqual(receipt)
  })

  it('returns null for comments without a receipt block', () => {
    expect(parseReceipt('just a comment')).toBeNull()
    expect(parseReceipt('<!-- treadle:receipt not-json -->')).toBeNull()
  })
})
