import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertLoopConfig, loadConfig } from '../src/config.ts'

const sandboxConfig = fileURLToPath(
  new URL('../../treadle-sandbox/loop.config.ts', import.meta.url),
)

describe('loadConfig', () => {
  it('loads and validates the sandbox loop.config.ts', async () => {
    const config = await loadConfig(sandboxConfig)
    expect(config.app.healthUrl).toBe('http://127.0.0.1:4317/health')
    expect(config.checks.map((c) => c.name)).toEqual(['typecheck', 'lint', 'unit', 'e2e'])
    expect(config.checks[3]?.needsApp).toBe(true)
    expect(config.checks[2]?.report).toEqual({
      format: 'vitest-json',
      path: '.treadle/reports/unit.json',
    })
    expect(config.budgets.passesPerIssue).toBe(3)
  })

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
})
