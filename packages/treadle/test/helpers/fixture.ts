import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CheckStep } from '../../src/config.ts'

export const FIXTURE_PORT = 4399
export const FIXTURE_BASE_URL = `http://127.0.0.1:${FIXTURE_PORT}`

const SERVER_JS = `
import http from 'node:http'
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok') }
  else if (req.url === '/ping') { res.writeHead(200); res.end('pong') }
  else { res.writeHead(404); res.end() }
})
server.listen(Number(process.env.PORT), '127.0.0.1')
`

const CHECK_APP_JS = `
const res = await fetch(process.env.APP_URL + '/ping')
const body = await res.text()
console.log('GET /ping -> ' + res.status + ' ' + body)
process.exit(res.ok && body === 'pong' ? 0 : 1)
`

const WRITE_REPORT_JS = `
import { writeFileSync } from 'node:fs'
const report = {
  success: false,
  numFailedTests: 2,
  testResults: [
    {
      assertionResults: [
        { fullName: 'reads > marks done', status: 'failed', failureMessages: ['expected 200, got 500'] },
        { fullName: 'reads > adds item', status: 'failed', failureMessages: ['boom'] },
        { fullName: 'reads > lists items', status: 'passed' },
      ],
    },
  ],
}
writeFileSync('report.json', JSON.stringify(report))
process.exit(1)
`

export const fixtureSteps: Record<string, CheckStep> = {
  ok: { name: 'ok', run: 'node -e "process.exit(0)"', timeoutSeconds: 10 },
  ping: {
    name: 'ping',
    run: 'node check-app.js',
    needsApp: true,
    env: { APP_URL: FIXTURE_BASE_URL },
    timeoutSeconds: 10,
  },
  unitFail: {
    name: 'unit',
    run: 'node write-report.js',
    report: { format: 'vitest-json', path: 'report.json' },
    timeoutSeconds: 10,
  },
  plainFail: { name: 'plain', run: 'node -e "process.exit(1)"', timeoutSeconds: 10 },
  slow: { name: 'slow', run: 'node -e "setInterval(() => {}, 1000)"', timeoutSeconds: 1 },
  missingReport: {
    name: 'noreport',
    run: 'node -e "process.exit(0)"',
    report: { format: 'vitest-json', path: 'nope.json' },
    timeoutSeconds: 10,
  },
}

/** Create a throwaway target repo: a tiny app plus a loop.config.ts with the given Checks. */
export async function makeFixtureRepo(steps: CheckStep[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'treadle-fixture-'))
  await mkdir(join(dir, '.treadle'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(dir, 'server.js'), SERVER_JS)
  await writeFile(join(dir, 'check-app.js'), CHECK_APP_JS)
  await writeFile(join(dir, 'write-report.js'), WRITE_REPORT_JS)
  const config = {
    issues: { ready: 'treadle:ready', working: 'treadle:working', parked: 'treadle:parked' },
    install: 'true',
    app: {
      start: 'node server.js',
      env: { PORT: String(FIXTURE_PORT) },
      healthUrl: `${FIXTURE_BASE_URL}/health`,
      readyTimeoutSeconds: 10,
    },
    checks: steps,
    protectedPaths: [],
    featureDone: { changedPaths: ['src/**'], requireNewTests: true },
    budgets: {
      passesPerIssue: 3,
      stallAfterFlatPasses: 2,
      maxTurnsPerSession: 80,
      sessionTimeoutMinutes: 30,
      askHumanTimeoutMinutes: 20,
      passesPerNight: 20,
      stopAfterParkedInARow: 3,
    },
  }
  await writeFile(
    join(dir, 'loop.config.ts'),
    `export default ${JSON.stringify(config, null, 2)}\n`,
  )
  return dir
}

export async function removeFixtureRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
