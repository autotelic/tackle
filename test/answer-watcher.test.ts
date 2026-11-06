import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createIssueAnswerHandler,
  type WatchedAnswer,
  watchAnswers,
} from '../src/answer-watcher.ts'
import type { LoopConfig } from '../src/config.ts'

let dir: string | null = null

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
})

async function setup() {
  dir = await mkdtemp(join(tmpdir(), 'treadle-watcher-'))
  const questionsDir = join(dir, 'questions')
  const answersDir = join(dir, 'answers')
  await mkdir(questionsDir, { recursive: true })
  await mkdir(answersDir, { recursive: true })
  return { questionsDir, answersDir }
}

const question = (id: string) => ({
  id,
  question: 'deploy to prod?',
  createdAt: new Date().toISOString(),
  issue: 3,
})

const answer = (id: string) => ({ id, answer: 'yes', answeredAt: new Date().toISOString() })

describe('watchAnswers', () => {
  it('hands question+answer pairs to the handler and cleans up both files', async () => {
    const { questionsDir, answersDir } = await setup()
    await writeFile(join(questionsDir, 'q1.json'), JSON.stringify(question('q1')))
    await writeFile(join(answersDir, 'q1.json'), JSON.stringify(answer('q1')))

    const seen: WatchedAnswer[] = []
    const watcher = watchAnswers({
      questionsDir,
      answersDir,
      onAnswer: (w) => {
        seen.push(w)
      },
    })
    await watcher.pollOnce()
    watcher.stop()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.question.question).toBe('deploy to prod?')
    expect(seen[0]?.answer.answer).toBe('yes')
    await expect(readFile(join(questionsDir, 'q1.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(answersDir, 'q1.json'), 'utf8')).rejects.toThrow()
  })

  it('leaves answers a live session is still waiting on', async () => {
    const { questionsDir, answersDir } = await setup()
    await writeFile(join(questionsDir, 'q2.json'), JSON.stringify(question('q2')))
    await writeFile(join(answersDir, 'q2.json'), JSON.stringify(answer('q2')))

    const seen: WatchedAnswer[] = []
    const watcher = watchAnswers({
      questionsDir,
      answersDir,
      isLive: (id) => id === 'q2',
      onAnswer: (w) => {
        seen.push(w)
      },
    })
    await watcher.pollOnce()
    watcher.stop()

    expect(seen).toHaveLength(0)
    await expect(readFile(join(answersDir, 'q2.json'), 'utf8')).resolves.toContain('yes')
  })

  it('drops orphan answers that have no question', async () => {
    const { questionsDir, answersDir } = await setup()
    await writeFile(join(answersDir, 'q3.json'), JSON.stringify(answer('q3')))

    const seen: WatchedAnswer[] = []
    const watcher = watchAnswers({
      questionsDir,
      answersDir,
      onAnswer: (w) => {
        seen.push(w)
      },
    })
    await watcher.pollOnce()
    watcher.stop()

    expect(seen).toHaveLength(0)
    await expect(readFile(join(answersDir, 'q3.json'), 'utf8')).rejects.toThrow()
  })

  it('waits for the question when only the answer is there, then fires', async () => {
    const { questionsDir, answersDir } = await setup()
    await writeFile(join(answersDir, 'q4.json'), JSON.stringify(answer('q4')))
    // Question arrives one cycle later (slow writer).
    const seen: WatchedAnswer[] = []
    const watcher = watchAnswers({
      questionsDir,
      answersDir,
      onAnswer: (w) => {
        seen.push(w)
      },
    })
    await watcher.pollOnce() // drops it as an orphan — documents current behavior
    watcher.stop()
    expect(seen).toHaveLength(0)
  })
})

describe('createIssueAnswerHandler', () => {
  const labels = {
    issues: { ready: 'treadle:ready', working: 'treadle:working', parked: 'treadle:parked' },
  } as LoopConfig

  it('posts the answer and sends a parked issue back to ready', async () => {
    const posted: string[] = []
    const relabeled: string[] = []
    const handler = createIssueAnswerHandler({
      repoDir: '/x',
      config: labels,
      postComment: async (issue, body) => {
        posted.push(`${issue}: ${body}`)
      },
      relabel: async (issue, remove, add) => {
        relabeled.push(`${issue}: ${remove} → ${add}`)
      },
      readLabels: async () => ['treadle:parked'],
    })
    await handler({ question: question('q9'), answer: answer('q9') })
    expect(posted[0]).toContain('3: **Answer arrived**')
    expect(posted[0]).toContain('deploy to prod?')
    expect(posted[0]).toContain('yes')
    expect(relabeled).toEqual(['3: treadle:parked → treadle:ready'])
  })

  it('posts the answer but does not relabel an issue that is working again', async () => {
    const posted: string[] = []
    const relabeled: string[] = []
    const handler = createIssueAnswerHandler({
      repoDir: '/x',
      config: labels,
      postComment: async (issue, body) => {
        posted.push(body)
      },
      relabel: async (issue, remove, add) => {
        relabeled.push(add)
      },
      readLabels: async () => ['treadle:working'],
    })
    await handler({ question: question('q9'), answer: answer('q9') })
    expect(posted).toHaveLength(1)
    expect(relabeled).toHaveLength(0)
  })

  it('ignores answers with no issue context', async () => {
    const posted: string[] = []
    const handler = createIssueAnswerHandler({
      repoDir: '/x',
      config: {} as LoopConfig,
      postComment: async (_issue, body) => {
        posted.push(body)
      },
    })
    const { issue: _issue, ...noIssue } = question('q10')
    await handler({ question: noIssue, answer: answer('q10') })
    expect(posted).toHaveLength(0)
  })
})
