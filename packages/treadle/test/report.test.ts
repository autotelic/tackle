import { describe, expect, it } from 'vitest'
import { buildFailureSet, parseVitestJsonReport, type StepResult } from '../src/report.ts'

const VITEST_JSON = JSON.stringify({
  success: false,
  numFailedTests: 1,
  testResults: [
    {
      assertionResults: [
        { fullName: 'suite > fails here', status: 'failed', failureMessages: ['nope'] },
        { fullName: 'suite > passes', status: 'passed' },
      ],
    },
    {
      assertionResults: [{ title: 'untitled failure', status: 'failed' }],
    },
  ],
})

describe('parseVitestJsonReport', () => {
  it('extracts failing tests only', () => {
    expect(parseVitestJsonReport(VITEST_JSON)).toEqual([
      { fullName: 'suite > fails here', failureMessages: ['nope'] },
      { fullName: 'untitled failure', failureMessages: [] },
    ])
  })

  it('returns an empty list for a green report', () => {
    expect(parseVitestJsonReport(JSON.stringify({ success: true, testResults: [] }))).toEqual([])
  })
})

function step(partial: Partial<StepResult> & { name: string }): StepResult {
  return { exitCode: 0, durationMs: 1, logTail: '', logPath: 'logs/x.log', ...partial }
}

describe('buildFailureSet', () => {
  it('is empty when every check passed', () => {
    expect(buildFailureSet([step({ name: 'a' })])).toEqual([])
  })

  it('has one entry per failing check that has no test report', () => {
    const set = buildFailureSet([step({ name: 'typecheck', exitCode: 2 })])
    expect(set).toEqual([{ check: 'typecheck', detail: '2 — no output captured' }])
  })

  it('carries the last error-leaning lines of a report-less failure', () => {
    const set = buildFailureSet([
      step({
        name: 'rest-gate',
        exitCode: 1,
        logTail: 'seeding done\n  1 failing\n  AssertionError: expected 403 to equal 200',
      }),
    ])
    expect(set).toEqual([
      { check: 'rest-gate', detail: '1 — 1 failing | AssertionError: expected 403 to equal 200' },
    ])
  })

  it('has one entry per failing test when the check has a report', () => {
    const set = buildFailureSet([
      step({
        name: 'unit',
        exitCode: 1,
        report: {
          format: 'vitest-json',
          failingTests: [
            { fullName: 'a > b', failureMessages: ['first'] },
            { fullName: 'a > c', failureMessages: [] },
          ],
        },
      }),
    ])
    expect(set).toEqual([
      { check: 'unit', test: 'a > b', detail: 'first' },
      { check: 'unit', test: 'a > c', detail: undefined },
    ])
  })

  it('falls back to a check-level entry when a failing check’s report has no failing tests', () => {
    const set = buildFailureSet([
      step({ name: 'unit', exitCode: 1, report: { format: 'vitest-json', failingTests: [] } }),
    ])
    expect(set).toEqual([{ check: 'unit', detail: '1 — no output captured' }])
  })

  it('skips timed-out and killed steps (those are infrastructure failures)', () => {
    expect(buildFailureSet([step({ name: 'slow', exitCode: null, timedOut: true })])).toEqual([])
  })
})
