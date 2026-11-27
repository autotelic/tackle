import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Receipt, renderReceipt } from '../src/receipt.ts'
import { renderStats, statsReport } from '../src/stats.ts'

const receipt = (issue: number, pass: number, turns: number, costUsd: number): Receipt => ({
  issue,
  pass,
  budget: 4,
  terminal: 'completed',
  turns,
  costUsd,
  sessionLogPath: `/elsewhere/sessions/issue-${issue}-pass-${pass}-2026-01-01T00-00-00-000Z.jsonl`,
  checkpoint: 'abcdef0123456789',
  checks: { outcome: 'checks.passed', frontier: 0, failureSet: [], reportDir: '/tmp/r' },
})

const sessionLog = (minutes: number): string => {
  const start = Date.parse('2026-01-01T00:00:00Z')
  const end = start + minutes * 60_000
  return [
    `{"ts":"${new Date(start).toISOString()}","event":{"type":"agent_start"}}`,
    `{"ts":"${new Date(end).toISOString()}","event":{"type":"agent_end"}}`,
  ].join('\n')
}

const tree = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'treadle-stats-'))
  mkdirSync(join(dir, 'issues'), { recursive: true })
  writeFileSync(join(dir, 'issues', '001-one.md'), '---\nstate: done\n---\n\n# one\n')
  writeFileSync(join(dir, 'issues', '002-two.md'), '---\nstate: parked\n---\n\n# two\n')
  mkdirSync(join(dir, 'log', '001'), { recursive: true })
  mkdirSync(join(dir, 'log', '002'), { recursive: true })
  writeFileSync(join(dir, 'log', '001', 'a.md'), renderReceipt(receipt(1, 1, 40, 0.2)))
  writeFileSync(join(dir, 'log', '001', 'b.md'), renderReceipt(receipt(1, 2, 60, 0.3)))
  writeFileSync(join(dir, 'log', '002', 'c.md'), renderReceipt(receipt(2, 1, 20, 0.02)))
  return dir
}

describe('statsReport', () => {
  it('totals the receipts per issue, with the state from the tracker', async () => {
    const dir = tree()
    try {
      const report = await statsReport({ trackerDir: dir, sessionsDir: null })
      expect(report.totals.issues).toBe(2)
      expect(report.totals.passes).toBe(3)
      expect(report.totals.turns).toBe(120)
      expect(report.totals.costUsd).toBeCloseTo(0.52, 5)
      expect(report.issues[0]).toMatchObject({ issue: 1, passes: 2, turns: 100, state: 'done' })
      expect(report.issues[1]).toMatchObject({ issue: 2, passes: 1, state: 'parked' })
      expect(report.totals.medianCostUsd).toBeCloseTo((0.5 + 0.02) / 2, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads active time from the session logs when they are present, and says how many it timed', async () => {
    const dir = tree()
    const sessions = mkdtempSync(join(tmpdir(), 'treadle-sessions-'))
    try {
      writeFileSync(join(sessions, 'issue-1-pass-1-2026-01-01T00-00-00-000Z.jsonl'), sessionLog(10))
      writeFileSync(join(sessions, 'issue-1-pass-2-2026-01-01T00-00-00-000Z.jsonl'), sessionLog(20))
      const report = await statsReport({ trackerDir: dir, sessionsDir: sessions })
      expect(report.totals.activeMinutes).toBeCloseTo(30, 5)
      expect(report.totals.timedPasses).toBe(2)
      expect(report.issues[0]?.activeMinutes).toBeCloseTo(30, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(sessions, { recursive: true, force: true })
    }
  })

  it('reports no time rather than zero when the logs are gone', async () => {
    const dir = tree()
    try {
      const report = await statsReport({ trackerDir: dir, sessionsDir: '/nonexistent-sessions' })
      expect(report.totals.timedPasses).toBe(0)
      expect(report.totals.activeMinutes).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders a table and the totals a budget conversation needs', async () => {
    const dir = tree()
    try {
      const text = renderStats(await statsReport({ trackerDir: dir, sessionsDir: null }))
      expect(text).toContain('issue  state')
      expect(text).toContain('2 issue(s), 3 pass(es), 120 turns')
      expect(text).toContain('mean $0.26 / median $0.26')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
