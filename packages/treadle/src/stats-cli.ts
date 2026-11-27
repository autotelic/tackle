import { join, resolve } from 'node:path'
import { loadConfig } from './config.ts'
import { renderStats, statsReport } from './stats.ts'

/**
 * `treadle stats --repo <loop clone|tracker>`: what the run cost, in money and
 * in time, per issue. Reads the tracker's receipts and, when it is still there,
 * the loop clone's session logs.
 *
 * Usage:
 *   node src/stats-cli.ts --repo ~/Projects/emdash-kit-loop [--format json]
 */
const args: Record<string, string> = {}
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 2) {
  const key = argv[index]
  const value = argv[index + 1]
  if (!key?.startsWith('--') || value === undefined) {
    console.error('usage: node src/stats-cli.ts --repo <loop clone> [--format text|json]')
    process.exit(64)
  }
  args[key.slice(2)] = value
}
if (!args.repo) {
  console.error('usage: node src/stats-cli.ts --repo <loop clone> [--format text|json]')
  process.exit(64)
}
const repoDir = resolve(args.repo)
const config = await loadConfig(join(repoDir, 'loop.config.ts'))
const trackerDir = config.issues.tracker === 'markdown' ? (config.issues.dir ?? null) : null
const report = await statsReport({ trackerDir, sessionsDir: join(repoDir, '.treadle', 'sessions') })
if (args.format === 'json') console.log(JSON.stringify(report, null, 2))
else process.stdout.write(renderStats(report))
