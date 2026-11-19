import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runChecks } from '../src/checks.ts'
import { loadConfig } from '../src/config.ts'
import {
  FIXTURE_PORT,
  fixtureSteps,
  makeFixtureRepo,
  removeFixtureRepo,
} from './helpers/fixture.ts'

let repoDir: string | null = null

afterEach(async () => {
  if (repoDir) await removeFixtureRepo(repoDir)
  repoDir = null
})

async function run(steps: (keyof typeof fixtureSteps)[]) {
  repoDir = await makeFixtureRepo(steps.map((s) => fixtureSteps[s]))
  const config = await loadConfig(join(repoDir, 'loop.config.ts'))
  const report = await runChecks(config, { repoDir, outDir: join(repoDir, '.treadle', 'out') })
  return { report, repoDir }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('runChecks', () => {
  it('passes when every check succeeds, starting and always stopping the app', async () => {
    const { report, repoDir: dir } = await run(['ok', 'ping'])
    expect(report.outcome).toBe('checks.passed')
    expect(report.infrastructureFailure).toBeNull()
    expect(report.frontier).toBe(0)
    expect(report.steps.map((s) => s.name)).toEqual(['ok', 'ping'])

    // App was stopped and its pid file removed.
    await expect(readFile(join(dir, '.treadle', 'app.pid'), 'utf8')).rejects.toThrow()
    const probe = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port: FIXTURE_PORT, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    expect(probe).toBe(false)

    // Full logs were written alongside the report.
    const pingLog = await readFile(join(dir, '.treadle', 'out', 'logs', 'ping.log'), 'utf8')
    expect(pingLog).toContain('pong')

    // The report itself lands beside them: the session prompt and the
    // run_checks tool result name <outDir>/checks.json as the full report.
    const persisted = JSON.parse(
      await readFile(join(dir, '.treadle', 'out', 'checks.json'), 'utf8'),
    ) as { outcome: string; steps: { name: string }[] }
    expect(persisted.outcome).toBe('checks.passed')
    expect(persisted.steps.map((s) => s.name)).toEqual(['ok', 'ping'])
  })

  it('reports failing tests from a vitest-json report', async () => {
    const { report } = await run(['ok', 'unitFail'])
    expect(report.outcome).toBe('checks.failed')
    expect(report.frontier).toBe(2)
    expect(report.failureSet).toEqual([
      { check: 'unit', test: 'reads > marks done', detail: 'expected 200, got 500' },
      { check: 'unit', test: 'reads > adds item', detail: 'boom' },
    ])
  })

  it('has one failure-set entry for a failing check with no report', async () => {
    const { report } = await run(['plainFail', 'unitFail'])
    expect(report.outcome).toBe('checks.failed')
    expect(report.frontier).toBe(3)
    expect(report.failureSet[0]).toEqual({ check: 'plain', detail: '1 — no output captured' })
  })

  it('treats a check timeout as an infrastructure failure and stops the run', async () => {
    const { report } = await run(['slow', 'ok'])
    expect(report.outcome).toBeNull()
    expect(report.infrastructureFailure).toMatchObject({ kind: 'step-timeout', step: 'slow' })
    expect(report.steps).toHaveLength(1)
    expect(report.steps[0]?.timedOut).toBe(true)
    expect(report.frontier).toBe(0)
  })

  it('treats a missing test report as an infrastructure failure', async () => {
    const { report } = await run(['missingReport'])
    expect(report.outcome).toBeNull()
    expect(report.infrastructureFailure).toMatchObject({
      kind: 'report-unreadable',
      step: 'noreport',
    })
  })

  it('refuses to run checks when the app port is already busy', async () => {
    repoDir = await makeFixtureRepo([fixtureSteps.ping])
    const blocker = net.createServer().listen(FIXTURE_PORT, '127.0.0.1')
    await new Promise((resolve) => blocker.once('listening', resolve))
    try {
      const config = await loadConfig(join(repoDir, 'loop.config.ts'))
      const report = await runChecks(config, {
        repoDir,
        outDir: join(repoDir, '.treadle', 'out'),
      })
      expect(report.infrastructureFailure?.kind).toBe('port-busy')
      expect(report.steps).toHaveLength(0)
    } finally {
      blocker.close()
    }
  })

  it('kills a leftover app recorded in the pid file before starting', async () => {
    repoDir = await makeFixtureRepo([fixtureSteps.ping])
    const leftover = spawn(process.execPath, ['server.js'], {
      cwd: repoDir,
      env: { ...process.env, PORT: String(FIXTURE_PORT) },
      detached: true,
      stdio: 'ignore',
    })
    await mkdir(join(repoDir, '.treadle'), { recursive: true })
    await writeFile(join(repoDir, '.treadle', 'app.pid'), String(leftover.pid))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(isAlive(leftover.pid ?? 0)).toBe(true)

    const config = await loadConfig(join(repoDir, 'loop.config.ts'))
    const report = await runChecks(config, { repoDir, outDir: join(repoDir, '.treadle', 'out') })

    expect(report.outcome).toBe('checks.passed')
    expect(isAlive(leftover.pid ?? 0)).toBe(false)
  })

  it('treats a failing install as an infrastructure failure', async () => {
    repoDir = await makeFixtureRepo([fixtureSteps.ok])
    const config = await loadConfig(join(repoDir, 'loop.config.ts'))
    const report = await runChecks(
      { ...config, install: 'false' },
      { repoDir, outDir: join(repoDir, '.treadle', 'out') },
    )
    expect(report.infrastructureFailure?.kind).toBe('install-failed')
    expect(report.steps).toHaveLength(0)
  })

  it('treats an app that never becomes healthy as an infrastructure failure', async () => {
    repoDir = await makeFixtureRepo([fixtureSteps.ping])
    const config = await loadConfig(join(repoDir, 'loop.config.ts'))
    if (!config.app) throw new Error('fixture config must have an app')
    const broken = {
      ...config,
      app: { ...config.app, start: 'node -e "process.exit(1)"', readyTimeoutSeconds: 3 },
    }
    const report = await runChecks(broken, { repoDir, outDir: join(repoDir, '.treadle', 'out') })
    expect(report.infrastructureFailure?.kind).toBe('app-not-healthy')
    expect(report.steps).toHaveLength(0)
  })
})
