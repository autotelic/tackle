import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoopConfig } from './config.ts'
import { comment, readLabels, relabel } from './loop/tracker.ts'
import type { AnswerFile, QuestionFile } from './telepi.ts'

/**
 * The Loop's watcher for late human answers (#8/#9 park-and-resume, #14).
 *
 * When a Session's ask_human times out, its question file stays in
 * ~/.treadle/questions/ and the issue parks. The question is still answerable
 * via /treadle; this watcher sees the answer land, hands it to the Loop's
 * handler, and cleans up both files. Answers for questions a live Session is
 * still waiting on are left to that Session.
 */

export type WatchedAnswer = {
  question: QuestionFile
  answer: AnswerFile
}

export type AnswerWatcherOptions = {
  questionsDir: string
  answersDir: string
  pollMs?: number
  /** Ids a live Session is waiting on right now; those answers are its business. */
  isLive?: (id: string) => boolean
  onAnswer: (watched: WatchedAnswer) => Promise<void> | void
}

export type AnswerWatcher = {
  stop: () => void
  /** Exposed for tests: run one poll cycle. */
  pollOnce: () => Promise<void>
}

export function watchAnswers(options: AnswerWatcherOptions): AnswerWatcher {
  const pollMs = options.pollMs ?? 5000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const pollOnce = async () => {
    let names: string[]
    try {
      names = await readdir(options.answersDir)
    } catch {
      return
    }
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      if (stopped) return
      const id = name.slice(0, -'.json'.length)
      if (options.isLive?.(id)) continue
      let answer: AnswerFile
      let question: QuestionFile
      try {
        answer = JSON.parse(await readFile(join(options.answersDir, name), 'utf8')) as AnswerFile
      } catch {
        continue // partially written; next cycle
      }
      try {
        question = JSON.parse(
          await readFile(join(options.questionsDir, name), 'utf8'),
        ) as QuestionFile
      } catch {
        // No matching question (already consumed, or withdrawn): drop the orphan.
        await rm(join(options.answersDir, name), { force: true })
        continue
      }
      await options.onAnswer({ question, answer })
      await rm(join(options.answersDir, name), { force: true })
      await rm(join(options.questionsDir, name), { force: true })
    }
  }

  const tick = async () => {
    if (stopped) return
    await pollOnce()
    if (!stopped) timer = setTimeout(() => void tick(), pollMs)
  }
  timer = setTimeout(() => void tick(), pollMs)

  return {
    pollOnce,
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}

/**
 * The Loop's parked-question handler (#8/#9): post the answer to the issue,
 * and send the issue back to ready so it's picked before issues not yet
 * started. Questions carry their issue/branch context, so this works from
 * files alone after a restart.
 */
export function createIssueAnswerHandler(options: {
  repoDir: string
  config: LoopConfig
  postComment?: (issue: number, body: string) => Promise<void>
  relabel?: (issue: number, remove: string, add: string) => Promise<void>
  readLabels?: (issue: number) => Promise<string[]>
}): (watched: WatchedAnswer) => Promise<void> {
  // The tracker is selected by the repo's loop.config.ts (#17, ADR-0002):
  // GitHub comments/labels or markdown log files/frontmatter state.
  const postComment =
    options.postComment ??
    (async (issue: number, body: string) => {
      await comment(options.repoDir, options.config, issue, body)
    })
  const relabelFn =
    options.relabel ??
    (async (issue: number, remove: string, add: string) => {
      await relabel(options.repoDir, options.config, issue, remove, add)
    })
  const readLabelsFn =
    options.readLabels ??
    (async (issue: number): Promise<string[]> => {
      return await readLabels(options.repoDir, options.config, issue)
    })

  return async ({ question, answer }) => {
    if (question.issue === undefined) return
    await postComment(
      question.issue,
      `**Answer arrived** (via /treadle):\n\n> ${question.question}\n\n${answer.answer}`,
    )
    // Only a parked issue goes back to ready — the answer may arrive while
    // the issue is already working again (a restart re-picked it), and
    // labels are the truth (#8).
    const labels = await readLabelsFn(question.issue)
    if (labels.includes(options.config.issues.parked)) {
      await relabelFn(question.issue, options.config.issues.parked, options.config.issues.ready)
    }
  }
}
