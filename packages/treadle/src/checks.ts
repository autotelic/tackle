import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CheckStep, LoopConfig } from './config.ts'
import {
  buildFailureSet,
  type CheckReport,
  type InfrastructureFailure,
  parseVitestJsonReport,
  type StepResult,
} from './report.ts'

const execFileAsync = promisify(execFile)

/** Keep this much of a step's log in checks.json; the full log is written alongside. */
const LOG_TAIL_CHARS = 4000
/** Grace between SIGTERM and SIGKILL when stopping a process group. */
const KILL_GRACE_MS = 2000

export type RunChecksOptions = {
  /** Absolute path of the target repository (the one with loop.config.ts). */
  repoDir: string
  /** Directory for checks.json and logs/. */
  outDir: string
  issue?: number
  pass?: number
}

type SpawnResult = {
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  logTail: string
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid: the whole process group, so nothing is orphaned behind a shell wrapper.
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stopProcessGroup(pid: number): Promise<void> {
  killGroup(pid, 'SIGTERM')
  const deadline = Date.now() + KILL_GRACE_MS
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (isAlive(pid)) killGroup(pid, 'SIGKILL')
}

/**
 * The login shell a check runs under.
 *
 * The operator's own shell first: node and pnpm live behind fnm on some machines, and only a
 * login shell has that PATH. Then bash, then sh, because a CI runner has no zsh at all and a
 * hardcoded `zsh` is a check that cannot run where it is deployed. Never interactive: `-i`
 * reads the operator's .zshrc, whose prompts and hooks then appear in a verifier's output, and
 * a check that depends on who ran it is not the hermetic check this file promises.
 */
function loginShell(): { command: string; args: ReadonlyArray<string> } {
  const fromEnv = process.env.SHELL
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv))
    return { command: fromEnv, args: ['-lc'] }
  if (existsSync('/bin/bash')) return { command: '/bin/bash', args: ['-lc'] }
  return { command: '/bin/sh', args: ['-lc'] }
}

/**
 * Run a shell command from `cwd`, streaming combined output to `logPath`.
 * On timeout the whole process group is killed and the result is marked timedOut.
 */
function spawnLogged(
  command: string,
  options: { cwd: string; env: Record<string, string>; logPath: string; timeoutSeconds: number },
): Promise<SpawnResult> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const shell = loginShell()
    const child = spawn(shell.command, [...shell.args, command], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.pid === undefined) {
      reject(new Error(`failed to spawn: ${command}`))
      return
    }
    const pid = child.pid

    const log = createWriteStream(options.logPath)
    let tail = ''
    const onData = (chunk: Buffer) => {
      log.write(chunk)
      tail = (tail + chunk.toString('utf8')).slice(-LOG_TAIL_CHARS)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void stopProcessGroup(pid)
    }, options.timeoutSeconds * 1000)

    child.on('error', (error) => {
      clearTimeout(timer)
      log.end()
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      log.end()
      resolve({ exitCode, timedOut, durationMs: Date.now() - start, logTail: tail })
    })
  })
}

async function isPortBusy(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * #8: before starting the app, kill a leftover from a previous run (recorded PID
 * file), then refuse to run the Checks if the port is still busy.
 */
export async function clearLeftoverApp(pidPath: string): Promise<void> {
  let pid: number
  try {
    pid = Number.parseInt((await readFile(pidPath, 'utf8')).trim(), 10)
  } catch {
    return // No pid file, nothing to clear.
  }
  if (Number.isFinite(pid) && isAlive(pid)) await stopProcessGroup(pid)
  await rm(pidPath, { force: true })
}

async function waitForHealth(
  healthUrl: string,
  readyTimeoutSeconds: number,
  appExited: () => number | null,
): Promise<{ healthy: boolean; detail: string }> {
  const deadline = Date.now() + readyTimeoutSeconds * 1000
  let lastDetail = 'no response yet'
  while (Date.now() < deadline) {
    const exitCode = appExited()
    if (exitCode !== null) return { healthy: false, detail: `app exited with code ${exitCode}` }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
      if (response.status < 500) return { healthy: true, detail: `HTTP ${response.status}` }
      lastDetail = `HTTP ${response.status}`
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { healthy: false, detail: `not healthy after ${readyTimeoutSeconds}s (${lastDetail})` }
}

async function currentBranch(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoDir,
    })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Run the Checks against a repository, deterministically, with no Session
 * involved (#11): install, start the app if any Check needs it, run every step
 * in order, always stop the app, and produce one CheckReport per Pass.
 *
 * Check-harness failures (port busy, app never healthy, a Check timing out, an
 * unreadable test report) come back as `infrastructureFailure` — a Pause (#9),
 * not a failed Pass.
 */
export async function runChecks(
  config: LoopConfig,
  options: RunChecksOptions,
): Promise<CheckReport> {
  const { repoDir, outDir } = options
  const startedAt = new Date()
  const logsDir = join(outDir, 'logs')
  await mkdir(logsDir, { recursive: true })

  const branch = await currentBranch(repoDir)
  const steps: StepResult[] = []
  let infrastructureFailure: InfrastructureFailure | null = null
  // CI=true so pnpm purges a stale node_modules without asking a TTY that
  // isn't there (bit us on a reused worktree, #16).
  const env = { CI: 'true', ...process.env } as Record<string, string>

  // 0. Install.
  const installLog = join(logsDir, 'install.log')
  const install = await spawnLogged(config.install, {
    cwd: repoDir,
    env,
    logPath: installLog,
    timeoutSeconds: 600,
  })
  if (install.exitCode !== 0) {
    infrastructureFailure = {
      kind: 'install-failed',
      detail: `install exited with code ${install.exitCode}: ${install.logTail.slice(-500)}`,
    }
  }

  // 1. Start the app if any Check needs it. It is always stopped again, on
  // success, failure or timeout.
  let appPid: number | null = null
  let appExitCode: number | null = null
  const treadleDir = join(repoDir, '.treadle')
  const pidPath = join(treadleDir, 'app.pid')
  const needsApp = config.checks.some((step) => step.needsApp)

  if (!infrastructureFailure && needsApp && config.app === undefined) {
    infrastructureFailure = {
      kind: 'app-not-healthy',
      detail: 'a check has needsApp but no app is configured',
    }
  }

  if (!infrastructureFailure && needsApp && config.app) {
    await mkdir(treadleDir, { recursive: true })
    await clearLeftoverApp(pidPath)

    const health = new URL(config.app.healthUrl)
    const port = Number(health.port || (health.protocol === 'https:' ? 443 : 80))
    if (await isPortBusy(port, health.hostname)) {
      infrastructureFailure = {
        kind: 'port-busy',
        detail: `${health.hostname}:${port} is already in use and no leftover app pid was recorded`,
      }
    } else {
      const appLog = join(logsDir, 'app.log')
      const shell = loginShell()
      const app = spawn(shell.command, [...shell.args, config.app.start], {
        cwd: repoDir,
        env: { ...env, ...config.app.env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (app.pid === undefined) {
        infrastructureFailure = {
          kind: 'app-not-healthy',
          detail: `failed to spawn: ${config.app.start}`,
        }
      } else {
        appPid = app.pid
        await writeFile(pidPath, String(appPid))
        const log = createWriteStream(appLog)
        app.stdout.on('data', (chunk: Buffer) => log.write(chunk))
        app.stderr.on('data', (chunk: Buffer) => log.write(chunk))
        app.on('close', (code) => {
          appExitCode = code
          log.end()
        })
        const healthResult = await waitForHealth(
          config.app.healthUrl,
          config.app.readyTimeoutSeconds,
          () => appExitCode,
        )
        if (!healthResult.healthy) {
          infrastructureFailure = { kind: 'app-not-healthy', detail: healthResult.detail }
        }
      }
    }
  }

  // 2. Run the Checks in order. A timeout is a harness failure: record it and
  // stop; the remaining steps never ran.
  if (!infrastructureFailure) {
    for (const step of config.checks) {
      const result = await runStep(step, repoDir, logsDir, { ...env, ...step.env })
      steps.push(result)
      if (result.timedOut) {
        infrastructureFailure = {
          kind: 'step-timeout',
          step: step.name,
          detail: `check '${step.name}' exceeded ${step.timeoutSeconds}s`,
        }
        break
      }
      if (step.report && result.report === undefined) {
        infrastructureFailure = {
          kind: 'report-unreadable',
          step: step.name,
          detail: `no readable ${step.report.format} report at ${step.report.path}`,
        }
        break
      }
    }
  }

  // 3. Always stop the app.
  if (appPid !== null) {
    await stopProcessGroup(appPid)
    await rm(pidPath, { force: true })
  }

  const failureSet = infrastructureFailure ? [] : buildFailureSet(steps)
  const report: CheckReport = {
    issue: options.issue ?? null,
    pass: options.pass ?? null,
    repo: repoDir,
    branch,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    outcome: infrastructureFailure
      ? null
      : failureSet.length === 0
        ? 'checks.passed'
        : 'checks.failed',
    infrastructureFailure,
    steps,
    failureSet,
    frontier: failureSet.length,
  }
  // The report lands beside its logs: the session prompt names
  // <outDir>/checks.json as the full report, and the run_checks tool result
  // repeats that path. Without this file the agent reads a phantom path.
  await writeFile(join(outDir, 'checks.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

async function runStep(
  step: CheckStep,
  repoDir: string,
  logsDir: string,
  env: Record<string, string>,
): Promise<StepResult> {
  const logPath = join(logsDir, `${step.name}.log`)
  const result = await spawnLogged(step.run, {
    cwd: repoDir,
    env,
    logPath,
    timeoutSeconds: step.timeoutSeconds,
  })
  const stepResult: StepResult = {
    name: step.name,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    logTail: result.logTail,
    logPath: `logs/${step.name}.log`,
    ...(result.timedOut ? { timedOut: true } : {}),
  }
  if (step.report && !result.timedOut) {
    try {
      const text = await readFile(join(repoDir, step.report.path), 'utf8')
      stepResult.report = { format: 'vitest-json', failingTests: parseVitestJsonReport(text) }
    } catch {
      // Missing or unparsable report: the caller turns this into a Pause.
    }
  }
  return stepResult
}
