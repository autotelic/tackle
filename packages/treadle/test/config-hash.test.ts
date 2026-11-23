import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertConfigCurrent, hashConfigText, StaleConfigError } from '../src/config.ts'
import { parseReceipt, type Receipt, renderReceipt } from '../src/receipt.ts'

/**
 * The gate must be the gate that was loaded.
 *
 * A config read once at startup is not the config running a pass: a checks list edited while the loop was
 * alive never ran, and the pass reported green anyway. These are the fixtures for that failure — load A,
 * edit to B, refuse — plus the receipt that names A, because a receipt that cannot name its gate is not
 * evidence.
 */
const configA = `export default {
  checks: [{ name: 'jig', run: 'pnpm jig check', timeoutSeconds: 900 }],
}
`
const configB = `export default {
  checks: [
    { name: 'jig', run: 'pnpm jig check', timeoutSeconds: 900 },
    { name: 'unit', run: 'pnpm test', timeoutSeconds: 600 },
  ],
}
`

const withConfig = async (text: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'treadle-config-'))
  const path = join(dir, 'loop.config.ts')
  await writeFile(path, text, 'utf8')
  return { path, hash: hashConfigText(text) }
}

describe('the loaded gate', () => {
  it('hashes the same text the same way, and an edit differently', () => {
    expect(hashConfigText(configA)).toBe(hashConfigText(configA))
    expect(hashConfigText(configA)).not.toBe(hashConfigText(configB))
  })

  it('accepts the file it was loaded from', async () => {
    const { path, hash } = await withConfig(configA)
    await expect(assertConfigCurrent(path, hash)).resolves.toBeUndefined()
  })

  it('refuses when a check was added after the load', async () => {
    const { path, hash } = await withConfig(configA)
    await writeFile(path, configB, 'utf8')
    await expect(assertConfigCurrent(path, hash)).rejects.toBeInstanceOf(StaleConfigError)
    await expect(assertConfigCurrent(path, hash)).rejects.toThrow(
      /StaleConfig: .* changed since load/,
    )
  })

  it('carries the gate into the receipt, by hash and by check name', () => {
    const receipt: Receipt = {
      issue: 1,
      pass: 2,
      budget: 5,
      terminal: 'completed',
      turns: 12,
      sessionLogPath: '/tmp/s.jsonl',
      checkpoint: 'abc123def456',
      checks: null,
      configHash: hashConfigText(configA),
      declaredChecks: [{ name: 'jig', run: 'pnpm jig check', timeoutSeconds: 900 }],
    }
    const body = renderReceipt(receipt)
    expect(body).toContain(hashConfigText(configA))
    expect(body).toContain('checks: jig')
    // and it survives the round trip the Loop relies on after a restart
    expect(parseReceipt(body)?.configHash).toBe(hashConfigText(configA))
    expect(parseReceipt(body)?.declaredChecks).toEqual([
      { name: 'jig', run: 'pnpm jig check', timeoutSeconds: 900 },
    ])
  })
})
