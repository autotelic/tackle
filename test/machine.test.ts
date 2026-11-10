import { createEffectActor, join } from '@xstate/effect'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { IssueLoopResult } from '../src/loop/issue-loop.ts'
import { buildLoopMachine, type LoopMachineDeps } from '../src/loop/machine.ts'
import type { Issue } from '../src/loop/tracker.ts'

const issue: Issue = { number: 1, title: 'thing', body: '' }
const prReady: IssueLoopResult = { kind: 'pr-ready', issue: 1, passesUsed: 1 }
const parked: IssueLoopResult = { kind: 'parked', issue: 1, passesUsed: 3, reason: 'budget' }

function makeDeps(overrides: Partial<LoopMachineDeps> = {}): LoopMachineDeps {
  return {
    pickIssue: async () => null,
    makeIssueLoop: () => Effect.succeed(prReady),
    escalate: () => Effect.void,
    notify: async () => {},
    parksToStop: 3,
    ...overrides,
  }
}

async function runMachine(deps: LoopMachineDeps, settleMs = 400) {
  const program = Effect.gen(function* () {
    const actor = yield* createEffectActor(buildLoopMachine(), { input: { deps } })
    yield* Effect.sleep(settleMs)
    return actor.getSnapshot()
  })
  return Effect.runPromise(Effect.scoped(program))
}

describe('loop machine', () => {
  it('works an issue to pr-ready, then idles in waiting', async () => {
    let picks = 0
    const worked: number[] = []
    const snapshot = await runMachine(
      makeDeps({
        pickIssue: async () => (++picks === 1 ? issue : null),
        makeIssueLoop: (i) => {
          worked.push(i.number)
          return Effect.succeed(prReady)
        },
      }),
    )
    expect(worked).toEqual([1])
    expect(snapshot.value).toBe('waiting')
    expect(snapshot.context.parksInARow).toBe(0)
  })

  it('escalates parked issues and stops after 3 parks in a row', async () => {
    let picks = 0
    const escalated: string[] = []
    const program = Effect.gen(function* () {
      const actor = yield* createEffectActor(buildLoopMachine(), {
        input: {
          deps: makeDeps({
            pickIssue: async () => (++picks <= 3 ? { ...issue, number: picks } : null),
            makeIssueLoop: (i) => Effect.succeed({ ...parked, issue: i.number }),
            escalate: (i) => {
              escalated.push(String(i.number))
              return Effect.void
            },
          }),
        },
      })
      yield* join(actor)
      return actor.getSnapshot()
    })
    const snapshot = await Effect.runPromise(Effect.scoped(program))
    expect(snapshot.value).toBe('stopped')
    expect(snapshot.context.stopReason).toContain('3 issues parked in a row')
    // The third park trips the circuit breaker, so its own escalation never
    // fires — the Loop stops and messages instead (#9).
    expect(escalated).toEqual(['1', '2'])
  })

  it('answer.arrived re-polls the queue but never cancels a working Session', async () => {
    const worked: number[] = []
    let picks = 0
    let snapshot: { value: unknown; context: { lastResult: IssueLoopResult | null } } | undefined
    const program = Effect.gen(function* () {
      const actor = yield* createEffectActor(buildLoopMachine(), {
        input: {
          deps: makeDeps({
            pickIssue: async () => (++picks === 1 ? issue : null),
            makeIssueLoop: (i) =>
              Effect.gen(function* () {
                worked.push(i.number)
                // While the Session is mid-flight, an answer lands.
                yield* Effect.sleep(100)
                return prReady
              }),
          }),
        },
      })
      yield* Effect.sleep(50)
      expect(actor.getSnapshot().value).toBe('working')
      actor.send({ type: 'answer.arrived' } as never)
      yield* Effect.sleep(200)
      // The working Session ran to completion — an unguarded transition
      // would have cancelled it (lastResult never set) and re-targeted
      // picking mid-flight.
      const final = actor.getSnapshot()
      snapshot = final
      expect(worked).toEqual([1])
      expect(final.context.lastResult?.kind).toBe('pr-ready')
      expect(final.value).toBe('waiting')
    })
    await Effect.runPromise(Effect.scoped(program))
    expect(snapshot).toBeDefined()
  })

  it('stops on stop.requested', async () => {
    const program = Effect.gen(function* () {
      const actor = yield* createEffectActor(buildLoopMachine(), {
        input: { deps: makeDeps() },
      })
      yield* Effect.sleep(100)
      actor.send({ type: 'stop.requested', reason: 'you chose Stop' } as never)
      yield* join(actor)
      return actor.getSnapshot()
    })
    const snapshot = await Effect.runPromise(Effect.scoped(program))
    expect(snapshot.value).toBe('stopped')
    expect(snapshot.context.stopReason).toBe('you chose Stop')
  })
})
