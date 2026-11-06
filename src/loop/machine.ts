import { createEffectLogic, setupEffect } from '@xstate/effect'
import { Effect } from 'effect'
import type { IssueLoopResult } from './issue-loop.ts'
import type { Issue } from './tracker.ts'

/**
 * The Loop machine (#15, skeleton per #7): picking → working → picking,
 * with the nightly cap, the 3-parks circuit breaker and Stop from Telegram
 * (#9). Per-issue work runs as an invoked Effect child; the Checks/Session/
 * human-channel modules stay plain underneath.
 */

export type LoopMachineDeps = {
  pickIssue: () => Promise<Issue | null>
  makeIssueLoop: (issue: Issue) => Effect.Effect<IssueLoopResult, Error>
  /** Escalate a parked issue on Telegram; resolves when Ed answers. */
  escalate: (issue: Issue, reason: string) => Effect.Effect<void, Error>
  notify: (text: string) => Promise<void>
  /** Stop when this many issues park in a row (#9). */
  parksToStop: number
}

export type MachineInput = {
  deps: LoopMachineDeps
  /** A working issue to re-enter after a restart (#8). */
  initialIssue?: Issue
}

type LoopContext = {
  deps: LoopMachineDeps
  issue: Issue | null
  parksInARow: number
  stopReason: string | null
  lastResult: IssueLoopResult | null
}

const asContext = (ctx: unknown) => ctx as LoopContext
const stopReasonFrom = (event: unknown, fallback: string) =>
  String((event as { reason?: unknown })?.reason ?? fallback)

export function buildLoopMachine() {
  const setup = setupEffect({
    actors: {
      pickIssue: createEffectLogic({
        effect: ({ input }) =>
          Effect.tryPromise({
            try: () => (input as { pickIssue: () => Promise<Issue | null> }).pickIssue(),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
      }),
      issueLoop: createEffectLogic({
        effect: ({ input }) =>
          (input as { make: () => Effect.Effect<IssueLoopResult, Error> }).make(),
      }),
    },
    actions: {
      notify: (args) =>
        Effect.gen(function* () {
          const params = (args as { params?: unknown }).params as { text: string }
          yield* Effect.tryPromise(() => asContext(args.context).deps.notify(params.text))
        }),
      escalateParked: (args) =>
        Effect.gen(function* () {
          const params = (args as { params?: unknown }).params as {
            issue: Issue
            reason: string
          }
          yield* asContext(args.context).deps.escalate(params.issue, params.reason)
        }),
    },
  })

  return setup.createMachine({
    id: 'treadle-loop',
    initial: 'picking',
    context: ({ input }) => {
      const { deps, initialIssue } = (input ?? {}) as MachineInput
      return {
        deps,
        issue: initialIssue ?? null,
        parksInARow: 0,
        stopReason: null,
        lastResult: null,
      } as LoopContext
    },
    on: {
      // Stop from a Telegram escalation answer, from any state (#9).
      'stop.requested': ({ event }) => ({
        target: '.stopped',
        context: { stopReason: stopReasonFrom(event, 'stop requested') },
      }),
      // A parked question got answered: re-poll the queue promptly.
      'answer.arrived': () => ({ target: '.picking' }),
    },
    states: {
      picking: {
        invoke: {
          src: 'pickIssue',
          input: ({ context }) => ({ pickIssue: asContext(context).deps.pickIssue }),
          onDone: ({ event }) => {
            const issue = (event as { output: Issue | null }).output
            return issue ? { target: 'working', context: { issue } } : { target: 'waiting' }
          },
          onError: ({ event }) => ({
            target: 'stopped',
            context: {
              stopReason: `queue poll failed: ${String((event as { error?: unknown }).error)}`,
            },
          }),
        },
      },
      waiting: {
        after: {
          60000: () => ({ target: 'picking' }),
        },
      },
      working: {
        invoke: {
          src: 'issueLoop',
          input: ({ context }) => {
            const c = asContext(context)
            return { make: () => c.deps.makeIssueLoop(c.issue as Issue) }
          },
          onDone: (args, enq) => {
            const result = (args.event as { output: IssueLoopResult }).output
            const c = asContext(args.context)
            if (result.kind === 'stopped-cap') {
              return {
                target: 'stopped',
                context: { stopReason: 'nightly cap reached' },
              }
            }
            if (result.kind === 'pr-ready') {
              return {
                target: 'picking',
                context: { parksInARow: 0, issue: null, lastResult: result },
              }
            }
            // blocked-on-human waits on Ed, so it neither escalates nor
            // counts toward the circuit breaker; the watcher resumes it.
            if (result.reason === 'blocked') {
              return {
                target: 'picking',
                context: { issue: null, lastResult: result },
              }
            }
            const parks = c.parksInARow + 1
            enq(args.actions.escalateParked, {
              ...args,
              params: { issue: c.issue as Issue, reason: result.reason },
            })
            if (parks >= c.deps.parksToStop) {
              return {
                target: 'stopped',
                context: {
                  stopReason: `${parks} issues parked in a row — vision, config or harness is probably wrong`,
                },
              }
            }
            return {
              target: 'picking',
              context: { parksInARow: parks, issue: null, lastResult: result },
            }
          },
          onError: ({ event }) => ({
            target: 'stopped',
            context: {
              stopReason: `issue loop failed: ${String((event as { error?: unknown }).error)}`,
            },
          }),
        },
      },
      stopped: { type: 'final' },
    },
  })
}
