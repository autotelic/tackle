import { pathToFileURL } from 'node:url'
import type { Rule } from './loop/rules.ts'

/** The pinned shape of a target repo's loop.config.ts (autotelic/project-loop#11). */

export type CheckReportRef = {
  format: 'vitest-json'
  /** Path to the JSON report, relative to the repo root. */
  path: string
}

export type CheckStep = {
  name: string
  /** Shell command, run from the repo root. */
  run: string
  timeoutSeconds: number
  /** Step needs the app running and healthy (the Loop starts it first). */
  needsApp?: boolean
  env?: Record<string, string>
  report?: CheckReportRef
}

export type AppConfig = {
  /** Start command, run so that stopping it leaves nothing behind (node directly, no pnpm wrapper). */
  start: string
  env?: Record<string, string>
  healthUrl: string
  readyTimeoutSeconds: number
}

export type IssueLabels = {
  ready: string
  working: string
  parked: string
  /**
   * Issue tracker selection (#17, ADR-0002): GitHub issues (default) or
   * markdown files in a directory (docs/markdown-issues.md). The ready /
   * working / parked values are GitHub label names on the GitHub tracker
   * and `state:` frontmatter values on the markdown tracker.
   */
  tracker?: 'github' | 'markdown'
  /**
   * markdown tracker: directory holding issues/ and log/, normally a git
   * repo the Loop pulls before reading and pushes after writing.
   */
  dir?: string
}

export type FeatureDoneGuard = {
  changedPaths: string[]
  requireNewTests: boolean
}

export type Budgets = {
  passesPerIssue: number
  stallAfterFlatPasses: number
  maxTurnsPerSession: number
  sessionTimeoutMinutes: number
  askHumanTimeoutMinutes: number
  passesPerNight: number
  stopAfterParkedInARow: number
  /** Optional dollar cap per issue across its Passes (#16). */
  maxCostPerIssueUsd?: number
}

export type LoopConfig = {
  issues: IssueLabels
  /** Shell command that installs dependencies, run before the Checks. */
  install: string
  app: AppConfig
  checks: CheckStep[]
  protectedPaths: string[]
  featureDone: FeatureDoneGuard
  budgets: Budgets
  /** User rules (#6, #15): (event, state, guard?) → action, declaration order. */
  rules?: Rule[]
}

function fail(configPath: string, what: string): never {
  throw new Error(`Invalid loop config at ${configPath}: ${what}`)
}

function assertString(value: unknown, what: string, configPath: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0)
    fail(configPath, `${what} must be a non-empty string`)
}

function assertNumber(value: unknown, what: string, configPath: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    fail(configPath, `${what} must be a positive number`)
}

function assertStringArray(
  value: unknown,
  what: string,
  configPath: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    fail(configPath, `${what} must be an array of strings`)
}

function assertEnv(value: unknown, what: string, configPath: string): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(configPath, `${what} must be a record of strings`)
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') fail(configPath, `${what}.${k} must be a string`)
  }
}

export function assertLoopConfig(
  config: unknown,
  configPath: string,
): asserts config is LoopConfig {
  if (typeof config !== 'object' || config === null)
    fail(configPath, 'default export must be an object')
  const c = config as Record<string, unknown>

  if (typeof c.issues !== 'object' || c.issues === null) fail(configPath, 'issues is required')
  for (const key of ['ready', 'working', 'parked'] as const)
    assertString((c.issues as Record<string, unknown>)[key], `issues.${key}`, configPath)
  const tracker = (c.issues as Record<string, unknown>).tracker
  if (tracker !== undefined && tracker !== 'github' && tracker !== 'markdown')
    fail(configPath, "issues.tracker must be 'github' or 'markdown'")
  const issuesDir = (c.issues as Record<string, unknown>).dir
  if (tracker === 'markdown') assertString(issuesDir, 'issues.dir', configPath)
  if (issuesDir !== undefined && tracker !== 'markdown')
    fail(configPath, "issues.dir only applies with issues.tracker: 'markdown'")

  assertString(c.install, 'install', configPath)

  if (typeof c.app !== 'object' || c.app === null) fail(configPath, 'app is required')
  const app = c.app as Record<string, unknown>
  assertString(app.start, 'app.start', configPath)
  assertString(app.healthUrl, 'app.healthUrl', configPath)
  assertNumber(app.readyTimeoutSeconds, 'app.readyTimeoutSeconds', configPath)
  assertEnv(app.env, 'app.env', configPath)

  if (!Array.isArray(c.checks) || c.checks.length === 0)
    fail(configPath, 'checks must be a non-empty array')
  const names = new Set<string>()
  for (const [i, step] of c.checks.entries()) {
    if (typeof step !== 'object' || step === null)
      fail(configPath, `checks[${i}] must be an object`)
    const s = step as Record<string, unknown>
    assertString(s.name, `checks[${i}].name`, configPath)
    if (names.has(s.name)) fail(configPath, `duplicate check name ${s.name}`)
    names.add(s.name)
    assertString(s.run, `checks[${i}].run`, configPath)
    assertNumber(s.timeoutSeconds, `checks[${i}].timeoutSeconds`, configPath)
    assertEnv(s.env, `checks[${i}].env`, configPath)
    if (s.needsApp !== undefined && typeof s.needsApp !== 'boolean')
      fail(configPath, `checks[${i}].needsApp must be a boolean`)
    if (s.report !== undefined) {
      if (typeof s.report !== 'object' || s.report === null)
        fail(configPath, `checks[${i}].report must be an object`)
      const r = s.report as Record<string, unknown>
      if (r.format !== 'vitest-json')
        fail(configPath, `checks[${i}].report.format must be 'vitest-json'`)
      assertString(r.path, `checks[${i}].report.path`, configPath)
    }
  }

  assertStringArray(c.protectedPaths, 'protectedPaths', configPath)

  if (typeof c.featureDone !== 'object' || c.featureDone === null)
    fail(configPath, 'featureDone is required')
  const fd = c.featureDone as Record<string, unknown>
  assertStringArray(fd.changedPaths, 'featureDone.changedPaths', configPath)
  if (typeof fd.requireNewTests !== 'boolean')
    fail(configPath, 'featureDone.requireNewTests must be a boolean')

  if (typeof c.budgets !== 'object' || c.budgets === null) fail(configPath, 'budgets is required')
  for (const [key, value] of Object.entries(c.budgets as Record<string, unknown>)) {
    if (key === 'maxCostPerIssueUsd' && value === undefined) continue
    assertNumber(value, `budgets.${key}`, configPath)
  }

  if (c.rules !== undefined) {
    if (!Array.isArray(c.rules)) fail(configPath, 'rules must be an array')
    const events = new Set(['checks.failed', 'checks.passed', 'feature.done', 'session.blocked'])
    const guards = new Set(['budget-left', 'not-stalled'])
    for (const [i, rule] of c.rules.entries()) {
      if (typeof rule !== 'object' || rule === null)
        fail(configPath, `rules[${i}] must be an object`)
      const r = rule as Record<string, unknown>
      assertString(r.name, `rules[${i}].name`, configPath)
      if (!events.has(r.on as string))
        fail(configPath, `rules[${i}].on must be one of ${[...events].join(', ')}`)
      if (r.in !== undefined) assertString(r.in, `rules[${i}].in`, configPath)
      if (r.guard !== undefined && !guards.has(r.guard as string))
        fail(configPath, `rules[${i}].guard must be one of ${[...guards].join(', ')}`)
      if (typeof r.action !== 'object' || r.action === null)
        fail(configPath, `rules[${i}].action is required`)
      const a = r.action as Record<string, unknown>
      if (a.type === 'session') {
        if (a.session !== 'fix-checks' && a.session !== 'review')
          fail(configPath, `rules[${i}].action.session must be fix-checks or review`)
      } else if (a.type === 'effect') {
        if (a.effect !== 'mark-ready-and-notify')
          fail(configPath, `rules[${i}].action.effect must be mark-ready-and-notify`)
      } else {
        fail(configPath, `rules[${i}].action.type must be session or effect`)
      }
    }
  }
}

/** Load and validate a loop.config.ts. Accepts an absolute path or one relative to the cwd. */
export async function loadConfig(configPath: string): Promise<LoopConfig> {
  const mod: unknown = await import(pathToFileURL(configPath).href)
  const config = (mod as { default?: unknown }).default
  assertLoopConfig(config, configPath)
  return config
}
