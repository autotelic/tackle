import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The TelePi human channel (#14). Outbound: Telegram Bot API sendMessage with
 * the bot token from TelePi's config (never getUpdates — TelePi owns those).
 * Inbound: question files in ~/.treadle/questions/, answered by the /treadle
 * extension command through ~/.treadle/answers/<id>.json, which this channel
 * watches for.
 */

export type TelePiConfig = {
  botToken: string
  /** First allowlisted Telegram user id; the Loop messages exactly one person. */
  chatId: string
}

export function parseTelePiConfigEnv(text: string): TelePiConfig {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const raw = trimmed.slice(eq + 1).trim()
    values[key] = raw.replace(/^["']|["']$/g, '')
  }
  const botToken = values.TELEGRAM_BOT_TOKEN
  const chatId = values.TELEGRAM_ALLOWED_USER_IDS?.split(',')[0]?.trim()
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN missing from TelePi config')
  if (!chatId) throw new Error('TELEGRAM_ALLOWED_USER_IDS missing from TelePi config')
  return { botToken, chatId }
}

export const DEFAULT_TELEPI_CONFIG_PATH = join(homedir(), '.config', 'telepi', 'config.env')

export async function loadTelePiConfig(path = DEFAULT_TELEPI_CONFIG_PATH): Promise<TelePiConfig> {
  return parseTelePiConfigEnv(await readFile(path, 'utf8'))
}

export async function telePiConfigExists(path = DEFAULT_TELEPI_CONFIG_PATH): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export type QuestionContext = {
  issue?: number
  issueUrl?: string
  branch?: string
  checkSummary?: string
}

export type QuestionFile = {
  id: string
  question: string
  /** Present for escalation-style questions; the extension shows a select. */
  options?: string[]
  createdAt: string
} & QuestionContext

export type AnswerFile = {
  id: string
  answer: string
  answeredAt: string
}

const TELEGRAM_MAX_CHARS = 4000

export function formatQuestionMessage(question: QuestionFile): string {
  const lines = [`Treadle asks:\n\n${question.question}`]
  if (question.issue !== undefined) {
    lines.push(
      question.issueUrl
        ? `Issue #${question.issue}: ${question.issueUrl}`
        : `Issue #${question.issue}`,
    )
  }
  if (question.branch) lines.push(`Branch: ${question.branch}`)
  if (question.checkSummary) lines.push(`Last checks: ${question.checkSummary}`)
  if (question.options && question.options.length > 0) {
    lines.push(`Options: ${question.options.join(' / ')}`)
  }
  lines.push('\nAnswer with /treadle')
  const text = lines.join('\n')
  return text.length > TELEGRAM_MAX_CHARS ? `${text.slice(0, TELEGRAM_MAX_CHARS - 1)}…` : text
}

export async function sendTelegramMessage(config: TelePiConfig, text: string): Promise<void> {
  // A hung Telegram socket must never freeze the Loop (#16): cap every send.
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    signal: AbortSignal.timeout(15_000),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, text }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status}: ${body.slice(0, 300)}`)
  }
}

export type TelePiChannelOptions = {
  config: TelePiConfig
  questionsDir: string
  answersDir: string
  /** How often to look for the answer file. */
  pollMs?: number
  /** Context carried by each question/message; evaluated per question. */
  context?: () => QuestionContext
  /**
   * Shared registry of ids a live ask is waiting on. The Loop's answer
   * watcher skips these, so a live Session's answer is never eaten (#14).
   */
  liveIds?: Set<string>
  /** Injectable for tests; defaults to the real Bot API call. */
  send?: (text: string) => Promise<void>
}

export type TelePiHumanChannel = {
  askHuman: (question: string, signal?: AbortSignal) => Promise<string>
  /** Escalation variant (Retry / Skip / Stop, #9): the answer is one of options. */
  askWithOptions: (question: string, options: string[], signal?: AbortSignal) => Promise<string>
}

export function createTelePiHumanChannel(options: TelePiChannelOptions): TelePiHumanChannel {
  const pollMs = options.pollMs ?? 2000
  const send = options.send ?? ((text: string) => sendTelegramMessage(options.config, text))

  async function ask(question: string, choices?: string[], signal?: AbortSignal): Promise<string> {
    await mkdir(options.questionsDir, { recursive: true })
    await mkdir(options.answersDir, { recursive: true })
    const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
    const file: QuestionFile = {
      id,
      question,
      ...(choices && choices.length > 0 ? { options: choices } : {}),
      createdAt: new Date().toISOString(),
      ...(options.context?.() ?? {}),
    }
    const questionPath = join(options.questionsDir, `${id}.json`)
    await writeFile(questionPath, JSON.stringify(file, null, 2))
    options.liveIds?.add(id)
    try {
      await send(formatQuestionMessage(file))
    } catch (error) {
      options.liveIds?.delete(id)
      await rm(questionPath, { force: true })
      throw new Error(`failed to deliver question to Telegram: ${String(error)}`)
    }

    const answerPath = join(options.answersDir, `${id}.json`)
    try {
      for (;;) {
        // A cancelled wait (the Session's ask_human timed out or was aborted)
        // stops polling but LEAVES the question file: the question stays
        // answerable via /treadle, and the Loop's answer watcher picks the
        // late answer up and resumes the issue (#8/#9 park-and-resume).
        if (signal?.aborted) throw new Error('wait cancelled')
        try {
          const answer = JSON.parse(await readFile(answerPath, 'utf8')) as AnswerFile
          if (answer.id === id && typeof answer.answer === 'string') {
            await rm(answerPath, { force: true })
            await rm(questionPath, { force: true })
            return answer.answer
          }
        } catch {
          // Not there yet, or partially written; look again in a moment.
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs))
      }
    } finally {
      options.liveIds?.delete(id)
    }
  }

  return {
    askHuman: (question, signal) => ask(question, undefined, signal),
    askWithOptions: (question, choices, signal) => ask(question, choices, signal),
  }
}
