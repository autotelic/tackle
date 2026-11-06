import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTelePiHumanChannel,
  formatQuestionMessage,
  parseTelePiConfigEnv,
  type QuestionFile,
} from '../src/telepi.ts'

describe('parseTelePiConfigEnv', () => {
  it('reads the token and the first allowed user id', () => {
    const config = parseTelePiConfigEnv(
      '# comment\nTELEGRAM_BOT_TOKEN="123:abc"\nTELEGRAM_ALLOWED_USER_IDS=456, 789\nTELEPI_WORKSPACE=/x\n',
    )
    expect(config).toEqual({ botToken: '123:abc', chatId: '456' })
  })

  it('throws with a clear message when keys are missing', () => {
    expect(() => parseTelePiConfigEnv('TELEGRAM_ALLOWED_USER_IDS=1')).toThrow(/TELEGRAM_BOT_TOKEN/)
    expect(() => parseTelePiConfigEnv('TELEGRAM_BOT_TOKEN=x')).toThrow(/TELEGRAM_ALLOWED_USER_IDS/)
  })
})

describe('formatQuestionMessage', () => {
  it('carries the question, issue link, branch and check summary', () => {
    const text = formatQuestionMessage({
      id: 'q1',
      question: 'Deploy to prod?',
      createdAt: '2026-11-05T00:00:00Z',
      issue: 3,
      issueUrl: 'https://github.com/autotelic/treadle-sandbox/issues/3',
      branch: 'loop/3',
      checkSummary: 'checks.failed, frontier 2',
    })
    expect(text).toContain('Deploy to prod?')
    expect(text).toContain('Issue #3: https://github.com/autotelic/treadle-sandbox/issues/3')
    expect(text).toContain('Branch: loop/3')
    expect(text).toContain('Last checks: checks.failed, frontier 2')
    expect(text).toContain('/treadle')
  })

  it('lists options for escalation questions', () => {
    const text = formatQuestionMessage({
      id: 'q2',
      question: 'Issue parked.',
      options: ['Retry with a hint', 'Skip', 'Stop'],
      createdAt: '2026-11-05T00:00:00Z',
    })
    expect(text).toContain('Options: Retry with a hint / Skip / Stop')
  })
})

describe('createTelePiHumanChannel', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  async function makeChannel(sent: string[], context?: () => { issue: number }) {
    dir = await mkdtemp(join(tmpdir(), 'treadle-telepi-'))
    const channel = createTelePiHumanChannel({
      config: { botToken: 't', chatId: 'c' },
      questionsDir: join(dir, 'questions'),
      answersDir: join(dir, 'answers'),
      pollMs: 20,
      send: async (text) => {
        sent.push(text)
      },
      ...(context ? { context } : {}),
    })
    return { channel, dir }
  }

  it('writes a question file, sends the message, and resolves with the answer', async () => {
    const sent: string[] = []
    const { channel, dir: root } = await makeChannel(sent, () => ({ issue: 7 }))
    const pending = channel.askHuman('what colour?')

    // The question file appears with the context the extension needs.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const questionPath = join(root, 'questions')
    const names = await import('node:fs/promises').then((fs) => fs.readdir(questionPath))
    expect(names).toHaveLength(1)
    const question = JSON.parse(
      await readFile(join(questionPath, names[0] as string), 'utf8'),
    ) as QuestionFile
    expect(question.question).toBe('what colour?')
    expect(question.issue).toBe(7)
    expect(sent[0]).toContain('what colour?')
    expect(sent[0]).toContain('Issue #7')

    // The answer file unblocks the call, and both files are cleaned up.
    await writeFile(
      join(root, 'answers', `${question.id}.json`),
      JSON.stringify({ id: question.id, answer: 'blue', answeredAt: new Date().toISOString() }),
    )
    await expect(pending).resolves.toBe('blue')
    await expect(readFile(join(questionPath, names[0] as string), 'utf8')).rejects.toThrow()
  })

  it('carries options for escalation questions', async () => {
    const sent: string[] = []
    const { channel, dir: root } = await makeChannel(sent)
    const pending = channel.askWithOptions('parked — what now?', ['Retry', 'Skip', 'Stop'])
    await new Promise((resolve) => setTimeout(resolve, 100))
    const names = await import('node:fs/promises').then((fs) => fs.readdir(join(root, 'questions')))
    const question = JSON.parse(
      await readFile(join(root, 'questions', names[0] as string), 'utf8'),
    ) as QuestionFile
    expect(question.options).toEqual(['Retry', 'Skip', 'Stop'])
    await writeFile(
      join(root, 'answers', `${question.id}.json`),
      JSON.stringify({ id: question.id, answer: 'Skip', answeredAt: new Date().toISOString() }),
    )
    await expect(pending).resolves.toBe('Skip')
  })

  it('removes the question file and rejects when the message cannot be sent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'treadle-telepi-'))
    const channel = createTelePiHumanChannel({
      config: { botToken: 't', chatId: 'c' },
      questionsDir: join(dir, 'questions'),
      answersDir: join(dir, 'answers'),
      send: async () => {
        throw new Error('HTTP 401: unauthorized')
      },
    })
    await expect(channel.askHuman('hello?')).rejects.toThrow(/failed to deliver/)
    const names = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(dir as string, 'questions')),
    )
    expect(names).toHaveLength(0)
  })
})
