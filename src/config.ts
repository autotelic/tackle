import { pathToFileURL } from 'node:url'

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
  for (const [key, value] of Object.entries(c.budgets as Record<string, unknown>))
    assertNumber(value, `budgets.${key}`, configPath)
}

/** Load and validate a loop.config.ts. Accepts an absolute path or one relative to the cwd. */
export async function loadConfig(configPath: string): Promise<LoopConfig> {
  const mod: unknown = await import(pathToFileURL(configPath).href)
  const config = (mod as { default?: unknown }).default
  assertLoopConfig(config, configPath)
  return config
}
