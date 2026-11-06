/**
 * Treadle's global Pi extension (#14): the /treadle command lists open
 * questions from ~/.treadle/questions/, asks via select or text input
 * (rendered as native Telegram UI by TelePi), and writes the answer to
 * ~/.treadle/answers/<id>.json, where the Loop is watching.
 *
 * Install: copy this file to ~/.pi/agent/extensions/treadle.ts and restart
 * TelePi (launchctl kickstart -k gui/<uid>/com.telepi) so its sessions load it.
 *
 * Canonical source: autotelic/project-loop, extensions/treadle.ts.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type QuestionFile = {
  id: string
  question: string
  options?: string[]
  createdAt: string
  issue?: number
  issueUrl?: string
  branch?: string
  checkSummary?: string
}

const QUESTIONS_DIR = join(homedir(), '.treadle', 'questions')
const ANSWERS_DIR = join(homedir(), '.treadle', 'answers')

async function listQuestions(): Promise<QuestionFile[]> {
  let names: string[]
  try {
    names = await readdir(QUESTIONS_DIR)
  } catch {
    return []
  }
  const questions: QuestionFile[] = []
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const question = JSON.parse(await readFile(join(QUESTIONS_DIR, name), 'utf8')) as QuestionFile
      if (typeof question.id === 'string' && typeof question.question === 'string') {
        questions.push(question)
      }
    } catch {
      // Partially written or malformed; skip it.
    }
  }
  return questions
}

function describe(question: QuestionFile): string {
  const lines = [question.question]
  if (question.issue !== undefined && question.issueUrl)
    lines.push(`Issue #${question.issue}: ${question.issueUrl}`)
  if (question.branch) lines.push(`Branch: ${question.branch}`)
  if (question.checkSummary) lines.push(`Last checks: ${question.checkSummary}`)
  return lines.join('\n')
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('treadle', {
    description: 'Answer open questions from the Treadle loop',
    handler: async (_args, ctx) => {
      const questions = await listQuestions()
      if (questions.length === 0) {
        ctx.ui.notify('No open Treadle questions.', 'info')
        return
      }

      let chosen = questions[0] as QuestionFile
      if (questions.length > 1) {
        const labels = questions.map((q) => `#${q.issue ?? '?'}: ${q.question.slice(0, 60)}`)
        const pick = await ctx.ui.select('Which question?', labels)
        if (pick === undefined) return
        chosen = questions[labels.indexOf(pick)] as QuestionFile
      }

      ctx.ui.notify(describe(chosen), 'info')
      let answer: string | undefined
      if (chosen.options && chosen.options.length > 0) {
        answer = await ctx.ui.select(chosen.question.slice(0, 200), chosen.options)
      } else {
        answer = await ctx.ui.input(chosen.question.slice(0, 200), 'type the answer')
      }
      if (answer === undefined || answer.trim().length === 0) {
        ctx.ui.notify('Cancelled — the question stays open.', 'warning')
        return
      }

      await mkdir(ANSWERS_DIR, { recursive: true })
      await writeFile(
        join(ANSWERS_DIR, `${chosen.id}.json`),
        `${JSON.stringify({ id: chosen.id, answer: answer.trim(), answeredAt: new Date().toISOString() }, null, 2)}\n`,
      )
      await rm(join(QUESTIONS_DIR, `${chosen.id}.json`), { force: true })
      ctx.ui.notify('Answer sent to the loop.', 'info')
    },
  })
}
