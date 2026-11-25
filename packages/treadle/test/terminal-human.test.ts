import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { askByFile } from '../src/terminal-human.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs.length = 0
})

async function world() {
  const root = await mkdtemp(join(tmpdir(), 'treadle-human-'))
  dirs.push(root)
  return { questionsDir: join(root, 'questions'), answersDir: join(root, 'answers') }
}

describe('askByFile', () => {
  it('writes the question, then returns the answer written to the answers dir', async () => {
    const { questionsDir, answersDir } = await world()
    const pending = askByFile('which scope?', { questionsDir, answersDir, pollMs: 20 })

    // The question exists, in the shape the answer watcher reads.
    let names: string[] = []
    for (let i = 0; i < 50 && names.length === 0; i += 1) {
      names = (await readdir(questionsDir).catch(() => [])).filter((n) => n.endsWith('.json'))
      if (names.length === 0) await new Promise((r) => setTimeout(r, 10))
    }
    expect(names).toHaveLength(1)
    const question = JSON.parse(await readFile(join(questionsDir, names[0]!), 'utf8'))
    expect(question.question).toBe('which scope?')
    expect(typeof question.id).toBe('string')

    await writeFile(
      join(answersDir, names[0]!),
      JSON.stringify({ id: question.id, answer: 'B', answeredAt: new Date().toISOString() }),
    )
    await expect(pending).resolves.toBe('B')
  })

  it('keeps waiting while the answer is missing, and stops when the signal aborts', async () => {
    const { questionsDir, answersDir } = await world()
    const controller = new AbortController()
    const pending = askByFile(
      'nobody answers',
      { questionsDir, answersDir, pollMs: 10 },
      controller.signal,
    )
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toThrow('cancelled')
  })
})
