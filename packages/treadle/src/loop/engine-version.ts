import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * The engine's own commit, so a running loop can notice its code moved.
 *
 * The config check catches a changed `loop.config.ts`, but not a changed engine:
 * a commit to `packages/treadle` while the loop is alive leaves the process
 * running the old source until someone restarts it — which is how a fix can be
 * committed, reviewed and reported as done while having no effect at all.
 *
 * Null when this is not a git checkout (a published install), in which case the
 * caller simply keeps comparing nothing.
 */
export async function engineHead(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })
    return stdout.trim() || null
  } catch {
    return null
  }
}
