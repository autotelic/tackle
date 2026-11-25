import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * The terminal human channel: answer ask_human questions.
 *
 * Two shapes, because the Loop runs in two places:
 *
 * - **A terminal** (`stdin.isTTY`): read the answer on stdin. Rejects when
 *   stdin closes, so a dead terminal ends the Session blocked-on-human instead
 *   of hanging forever.
 * - **A daemon** (launchd; no TTY): write the question to ~/.treadle/questions/
 *   and poll ~/.treadle/answers/ for the reply. Reading stdin there was a
 *   silent 30-minute stall per question — the Loop printed the question to a
 *   log nobody reads and waited for a keystroke that could never come. Under
 *   launchd the files ARE the channel: the escalation answerer, a person, or a
 *   watcher session can all answer by writing the answer file.
 */

const QUESTIONS_DIR = join(homedir(), '.treadle', 'questions')
const ANSWERS_DIR = join(homedir(), '.treadle', 'answers')
const POLL_MS = 2000

const newId = (): string =>
  `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type FileChannelOptions = {
  questionsDir?: string
  answersDir?: string
  pollMs?: number
}

/**
 * Ask by file: write the question, then poll for its answer. The question file
 * uses the same shape `answer-watcher.ts` and the escalation answerer read.
 */
export async function askByFile(
  question: string,
  options?: FileChannelOptions,
  signal?: AbortSignal,
): Promise<string> {
  const questionsDir = options?.questionsDir ?? QUESTIONS_DIR
  const answersDir = options?.answersDir ?? ANSWERS_DIR
  const pollMs = options?.pollMs ?? POLL_MS
  const id = newId()
  await mkdir(questionsDir, { recursive: true })
  await mkdir(answersDir, { recursive: true })
  await writeFile(
    join(questionsDir, `${id}.json`),
    `${JSON.stringify({ id, question, createdAt: new Date().toISOString() })}\n`,
  )
  const answerPath = join(answersDir, `${id}.json`)
  while (signal?.aborted !== true) {
    try {
      const parsed = JSON.parse(await readFile(answerPath, 'utf8')) as { answer?: unknown }
      if (typeof parsed.answer === 'string') return parsed.answer
    } catch {
      // Not answered yet (or partially written); keep waiting.
    }
    await sleep(pollMs)
  }
  throw new Error('question cancelled')
}

export function createTerminalHumanChannel(options?: {
  askHuman?: (question: string) => Promise<string>
}): {
  askHuman: (question: string) => Promise<string>
  close: () => void
} {
  // A daemon has no terminal to answer on: the files are the channel.
  if (options?.askHuman !== undefined || process.stdin.isTTY !== true) {
    return {
      askHuman: options?.askHuman ?? ((question) => askByFile(question)),
      close: () => {},
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let rlClosed = false
  let pendingReject: ((error: Error) => void) | null = null
  rl.once('close', () => {
    rlClosed = true
    pendingReject?.(new Error('stdin closed'))
  })
  const askHuman = (question: string): Promise<string> =>
    new Promise((resolveAnswer, reject) => {
      if (rlClosed) {
        reject(new Error('stdin is closed'))
        return
      }
      pendingReject = reject
      try {
        rl.question(`\n[ask_human] ${question}\nanswer> `, (answer) => {
          pendingReject = null
          resolveAnswer(answer)
        })
      } catch (error) {
        pendingReject = null
        reject(error)
      }
    })
  return { askHuman, close: () => rl.close() }
}
