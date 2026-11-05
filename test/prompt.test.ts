import { describe, expect, it } from 'vitest'
import { buildSessionPrompt, type SessionPromptInput } from '../src/prompt.ts'
import type { CheckReport } from '../src/report.ts'

const base: SessionPromptInput = {
  vision: '# Vision\n\nA reading-list service.',
  issue: {
    number: 1,
    title: 'Save and list items',
    body: '## Acceptance criteria\n\n- POST /items',
  },
  progressNote: null,
  lastReport: null,
  lastReportDir: null,
  previousSessionNote: null,
  pass: 1,
  budget: 3,
  protectedPaths: ['VISION.md', 'loop.config.ts'],
}

const failedReport: CheckReport = {
  issue: 1,
  pass: 1,
  repo: '/x',
  branch: 'loop/1',
  startedAt: '2026-11-05T00:00:00Z',
  durationMs: 1000,
  outcome: 'checks.failed',
  infrastructureFailure: null,
  steps: [],
  failureSet: [
    { check: 'unit', test: 'POST /items creates an item', detail: 'expected 201 got 404' },
    { check: 'typecheck', detail: 'exit code 2' },
  ],
  frontier: 2,
}

describe('buildSessionPrompt', () => {
  it('carries the vision, the issue and the first-pass framing', () => {
    const prompt = buildSessionPrompt(base)
    expect(prompt).toContain('A reading-list service.')
    expect(prompt).toContain('#1: Save and list items')
    expect(prompt).toContain('POST /items')
    expect(prompt).toContain('first Pass')
    expect(prompt).toContain('Create one at the repository root')
  })

  it('carries the progress note when one exists', () => {
    const prompt = buildSessionPrompt({ ...base, progressNote: '# Progress\n\nPOST works.' })
    expect(prompt).toContain('PROGRESS.md so far:')
    expect(prompt).toContain('POST works.')
  })

  it('names the failure set and the log paths from the last report', () => {
    const prompt = buildSessionPrompt({
      ...base,
      pass: 2,
      lastReport: failedReport,
      lastReportDir: '/repo/.treadle/checks-issue-1-pass-1',
      previousSessionNote: 'I got the routes wrong.',
    })
    expect(prompt).toContain('Pass 2 of 3')
    expect(prompt).toContain('checks.failed')
    expect(prompt).toContain('frontier 2')
    expect(prompt).toContain('unit › POST /items creates an item — expected 201 got 404')
    expect(prompt).toContain('- typecheck')
    expect(prompt).toContain('/repo/.treadle/checks-issue-1-pass-1/logs/')
    expect(prompt).toContain('I got the routes wrong.')
  })

  it('lists the protected paths', () => {
    const prompt = buildSessionPrompt(base)
    expect(prompt).toContain('`VISION.md`, `loop.config.ts`')
  })
})
