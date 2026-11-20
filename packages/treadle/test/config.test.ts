import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertLoopConfig, loadConfig } from '../src/config.ts'

// A live deployment's tracker config lives in a sibling checkout, not in this repository.
// It is exercised where it exists; a checkout without it must not be red.
const sandboxConfig = fileURLToPath(
  new URL('../../treadle-sandbox/loop.config.ts', import.meta.url),
)

describe('loadConfig', () => {
  it.skipIf(!existsSync(sandboxConfig))(
    'loads and validates the sandbox loop.config.ts',
    async () => {
      const config = await loadConfig(sandboxConfig)
      expect(config.app?.healthUrl).toBe('http://127.0.0.1:4317/health')
      expect(config.checks.map((c) => c.name)).toEqual(['typecheck', 'lint', 'unit', 'e2e'])
      expect(config.checks[3]?.needsApp).toBe(true)
      expect(config.checks[2]?.report).toEqual({
        format: 'vitest-json',
        path: '.treadle/reports/unit.json',
      })
      expect(config.budgets.passesPerIssue).toBe(3)
    },
  )

  it('rejects a config missing required fields', () => {
    expect(() => assertLoopConfig({}, 'x')).toThrow(/issues/)
    expect(() =>
      assertLoopConfig({ issues: { ready: 'a', working: 'b', parked: 'c' } }, 'x'),
    ).toThrow(/install/)
  })

  it('rejects duplicate check names and unknown report formats', () => {
    const base = {
      issues: { ready: 'a', working: 'b', parked: 'c' },
      install: 'true',
      app: { start: 'node s.js', healthUrl: 'http://127.0.0.1:1/health', readyTimeoutSeconds: 5 },
      checks: [
        { name: 't', run: 'true', timeoutSeconds: 5 },
        { name: 't', run: 'true', timeoutSeconds: 5 },
      ],
      protectedPaths: [],
      featureDone: { changedPaths: [], requireNewTests: true },
      budgets: { passesPerIssue: 3 },
    }
    expect(() => assertLoopConfig(base, 'x')).toThrow(/duplicate check name/)
    const badReport = structuredClone(base)
    badReport.checks = [
      { name: 't', run: 'true', timeoutSeconds: 5, report: { format: 'junit', path: 'r.xml' } },
    ] as unknown as typeof base.checks
    expect(() => assertLoopConfig(badReport, 'x')).toThrow(/vitest-json/)
  })

  it('accepts the markdown tracker with a directory, and requires the pair', () => {
    const base = {
      issues: { ready: 'ready', working: 'working', parked: 'parked' },
      install: 'true',
      app: { start: 'node s.js', healthUrl: 'http://127.0.0.1:1/health', readyTimeoutSeconds: 5 },
      checks: [{ name: 't', run: 'true', timeoutSeconds: 5 }],
      protectedPaths: [],
      featureDone: { changedPaths: [], requireNewTests: true },
      budgets: { passesPerIssue: 3 },
    }
    const markdown = structuredClone(base)
    Object.assign(markdown.issues, { tracker: 'markdown', dir: '/tmp/issues' })
    assertLoopConfig(markdown, 'x')
    expect(markdown.issues.tracker).toBe('markdown')

    const noDir = structuredClone(base)
    Object.assign(noDir.issues, { tracker: 'markdown' })
    expect(() => assertLoopConfig(noDir, 'x')).toThrow(/issues.dir/)

    const dirWithoutMarkdown = structuredClone(base)
    Object.assign(dirWithoutMarkdown.issues, { dir: '/tmp/issues' })
    expect(() => assertLoopConfig(dirWithoutMarkdown, 'x')).toThrow(/issues.dir/)

    const unknownTracker = structuredClone(base)
    Object.assign(unknownTracker.issues, { tracker: 'linear' })
    expect(() => assertLoopConfig(unknownTracker, 'x')).toThrow(/issues.tracker/)
  })

  it('allows an app-less config unless a check needsApp', () => {
    const base = {
      issues: { ready: 'a', working: 'b', parked: 'c' },
      install: 'true',
      checks: [{ name: 't', run: 'true', timeoutSeconds: 5 }],
      protectedPaths: [],
      featureDone: { changedPaths: [], requireNewTests: true },
      budgets: { passesPerIssue: 3 },
    }
    assertLoopConfig(base, 'x')
    expect(base.app).toBeUndefined()

    const needsApp = structuredClone(base)
    needsApp.checks = [{ name: 't', run: 'true', timeoutSeconds: 5, needsApp: true }]
    expect(() => assertLoopConfig(needsApp, 'x')).toThrow(/needsApp but no app/)
  })
})
