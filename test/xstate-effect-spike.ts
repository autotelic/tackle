/**
 * Spike (#15): the smallest possible XState 6 + @xstate/effect machine on this
 * machine — one Effect action, two states, driven to a terminal state through
 * createEffectActor + join inside Effect.scoped. Not a vitest test; run with
 * `node test/xstate-effect-spike.ts`. Delete when the real machine lands.
 */
import { createEffectActor, join, setupEffect } from '@xstate/effect'
import { Effect } from 'effect'

const setup = setupEffect({
  actions: {
    recordWork: ({ context }) =>
      Effect.gen(function* () {
        yield* Effect.log(`Effect action ran with context: ${JSON.stringify(context)}`)
      }),
  },
})

const machine = setup.createMachine({
  id: 'spike',
  initial: 'idle',
  context: { passes: 0 },
  states: {
    idle: {
      on: {
        start: (args, enq) => {
          enq(args.actions.recordWork, args)
          return { target: 'working', context: { passes: 1 } }
        },
      },
    },
    working: {
      on: {
        finish: () => ({ target: 'done' }),
      },
    },
    done: { type: 'final' },
  },
})

const program = Effect.gen(function* () {
  const actor = yield* createEffectActor(machine)
  actor.send({ type: 'start' })
  actor.send({ type: 'finish' })
  yield* join(actor)
  return actor.getSnapshot().value
})

const value = await Effect.runPromise(Effect.scoped(program))
console.log('terminal state:', value)
if (value !== 'done') throw new Error(`expected done, got ${String(value)}`)
console.log('spike OK')
