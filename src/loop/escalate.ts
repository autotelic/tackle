import { Effect } from 'effect'
import type { LoopConfig } from '../config.ts'
import type { HumanChannel } from '../human-channel.ts'
import { appendQa } from './issue-loop.ts'
import type { Issue } from './tracker.ts'
import { comment, issueUrl, relabel } from './tracker.ts'

/**
 * Parked-issue escalation (#9): Telegram question with Retry with a hint /
 * Skip / Stop. Runs as a machine Effect action, so it stays alive while the
 * Loop moves on to other issues. Retry posts the hint and sends the issue
 * back to ready; Stop halts the Loop.
 */
export function makeEscalate(deps: {
  repoDir: string
  config: LoopConfig
  human: HumanChannel
  notify: (text: string) => Promise<void>
  requestStop: (reason: string) => void
}): (issue: Issue, reason: string) => Effect.Effect<void, Error> {
  const { repoDir, config, human, notify } = deps
  const tryP = <A>(f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (e) => (e instanceof Error ? e : new Error(String(e))) })

  return (issue, reason) =>
    Effect.gen(function* () {
      const url = yield* tryP(() => issueUrl(repoDir, config, issue.number))
      const choice = yield* tryP(() =>
        human.askWithOptions(
          `Treadle parked issue #${issue.number} "${issue.title}" (${reason}).` +
            (url ? `\n${url}` : ''),
          ['Retry with a hint', 'Skip', 'Stop'],
        ),
      )
      if (choice === 'Stop') {
        deps.requestStop(`You chose Stop on issue #${issue.number}.`)
        yield* tryP(() => notify('Treadle stopping on your word.'))
        return
      }
      if (choice === 'Retry with a hint') {
        const hint = yield* tryP(() =>
          human.askHuman(`What hint should the retry of #${issue.number} get?`),
        )
        // Fresh budget of 3 (#9): the marker truncates the Receipt history.
        yield* tryP(() =>
          comment(
            repoDir,
            config,
            issue.number,
            `**Hint for the retry:**\n\n${hint}\n\n<!-- treadle:budget-reset -->`,
          ),
        )
        yield* tryP(() => appendQa(repoDir, issue.number, { question: 'Retry hint', answer: hint }))
        yield* tryP(() =>
          relabel(repoDir, config, issue.number, config.issues.parked, config.issues.ready),
        )
        yield* tryP(() => notify(`Issue #${issue.number} back to ready with your hint.`))
        return
      }
      // Skip: stays parked.
    })
}
