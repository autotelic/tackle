import { Clock, Effect, Exit, Fiber, Queue, Ref } from "effect"
import type { Scope } from "effect/Scope"

/** How a child is restarted when it ends. */
export type Restart = "permanent" | "transient" | "temporary"

/** One long-lived process the shop owns. */
export interface ChildSpec {
  readonly name: string
  readonly start: Effect.Effect<void>
  readonly restart?: Restart
}

export interface SupervisorOptions {
  readonly shop: string
  readonly strategy?: "one_for_one" | "rest_for_one"
  readonly maxRestarts?: number
  readonly periodMs?: number
}

export interface DeskItem {
  readonly shop: string
  readonly child: string
  readonly reason: "crash-looping"
  readonly at: number
}

export interface SupervisorStatus {
  readonly shop: string
  readonly blocked: boolean
  readonly restarts: number
  readonly children: ReadonlyArray<string>
}

export interface SupervisorHandle {
  /** Simulate a crash: interrupt the child; its watcher restarts it. */
  readonly crash: (name: string) => Effect.Effect<void>
  readonly status: Effect.Effect<SupervisorStatus>
  readonly desk: Queue.Dequeue<DeskItem>
  readonly stop: Effect.Effect<void>
}

/** A second supervisor for one shop is a bug, not a second owner. */
export class ShopBusy extends Error {
  readonly _tag = "ShopBusy"
  readonly shop: string
  constructor(shop: string) {
    super(`shop ${shop} already has a supervisor`)
    this.shop = shop
  }
}

type Child = {
  readonly spec: ChildSpec
  readonly fiber: Fiber.Fiber<void, never>
}

const shops = new Set<string>()

/**
 * A shop's supervision tree. A crash is an exit; the strategy decides what
 * else restarts. Intensity is a budget: exceed it and the tree stops and writes
 * one desk item, never a retry storm.
 */
export const supervise = (
  options: SupervisorOptions,
  specs: ReadonlyArray<ChildSpec>,
): Effect.Effect<SupervisorHandle, ShopBusy, Scope> =>
  Effect.gen(function* () {
    if (shops.has(options.shop)) return yield* Effect.fail(new ShopBusy(options.shop))
    shops.add(options.shop)
    yield* Effect.addFinalizer(() => Effect.sync(() => shops.delete(options.shop)))

    const scope = yield* Effect.scope
    const desk = yield* Queue.unbounded<DeskItem>()
    const children = yield* Ref.make<ReadonlyArray<Child>>([])
    const restarts = yield* Ref.make<ReadonlyArray<number>>([])
    const flags = yield* Ref.make({ blocked: false, stopping: false })
    const superseded = yield* Ref.make<ReadonlySet<Fiber.Fiber<void, never>>>(new Set())
    const maxRestarts = options.maxRestarts ?? 3
    const periodMs = options.periodMs ?? 60_000
    const strategy = options.strategy ?? "one_for_one"

    const forkChild = (spec: ChildSpec): Effect.Effect<Child, never, Scope> =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(spec.start, scope)
        yield* Effect.forkIn(
          Effect.gen(function* () {
            const exit = yield* Fiber.await(fiber)
            yield* onExit(spec, fiber, exit)
          }).pipe(Effect.catchCause((cause) => Effect.logDebug("supervisor watcher ended", cause))),
          scope,
        )
        return { spec, fiber }
      })

    const startChild = (spec: ChildSpec): Effect.Effect<Child, never, Scope> =>
      Effect.gen(function* () {
        const child = yield* forkChild(spec)
        yield* Ref.update(children, (cs) => [...cs, child])
        return child
      })

    const replace = (name: string, next: Child) =>
      Ref.update(children, (cs) => cs.map((c) => (c.spec.name === name ? next : c)))

    const onExit = (
      spec: ChildSpec,
      fiber: Fiber.Fiber<void, never>,
      exit: Exit.Exit<void, unknown>,
    ): Effect.Effect<void, never, Scope> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(superseded)).has(fiber)) return
        const currentChild = (yield* Ref.get(children)).find((c) => c.spec.name === spec.name)
        if (currentChild?.fiber !== fiber) return
        const state = yield* Ref.get(flags)
        if (state.stopping || state.blocked) return
        const restart = spec.restart ?? "permanent"
        if (restart === "temporary") return
        if (restart === "transient" && Exit.isSuccess(exit)) return

        const at = yield* Clock.currentTimeMillis
        const recent = [...(yield* Ref.get(restarts)).filter((t) => at - t < periodMs), at]
        if (recent.length > maxRestarts) {
          yield* Ref.set(flags, { ...state, blocked: true })
          yield* Ref.set(restarts, recent)
          yield* Queue.offer(desk, {
            shop: options.shop,
            child: spec.name,
            reason: "crash-looping",
            at,
          })
          const all = yield* Ref.get(children)
          yield* Effect.forEach(all, (c) => Fiber.interrupt(c.fiber), { discard: true })
          return
        }
        yield* Ref.set(restarts, recent)

        const order = (yield* Ref.get(children)).map((c) => c.spec.name)
        const from = order.indexOf(spec.name)
        const targets = strategy === "rest_for_one" ? order.slice(Math.max(0, from)) : [spec.name]
        for (const name of targets) {
          const all = yield* Ref.get(children)
          const child = all.find((c) => c.spec.name === name)
          if (child === undefined) continue
          yield* Ref.update(superseded, (set) => new Set([...set, child.fiber]))
          yield* Fiber.interrupt(child.fiber)
          yield* replace(name, yield* forkChild(child.spec))
        }
      })

    for (const spec of specs) yield* startChild(spec)

    return {
      crash: (name) =>
        Effect.gen(function* () {
          const child = (yield* Ref.get(children)).find((c) => c.spec.name === name)
          if (child !== undefined) yield* Fiber.interrupt(child.fiber)
        }),
      status: Effect.gen(function* () {
        const [state, times, cs] = yield* Effect.all([
          Ref.get(flags),
          Ref.get(restarts),
          Ref.get(children),
        ])
        return {
          shop: options.shop,
          blocked: state.blocked,
          restarts: times.length,
          children: cs.map((c) => c.spec.name),
        }
      }),
      desk,
      stop: Effect.gen(function* () {
        yield* Ref.update(flags, (s) => ({ ...s, stopping: true }))
        const all = yield* Ref.get(children)
        yield* Effect.forEach(all, (c) => Fiber.interrupt(c.fiber), { discard: true })
      }),
    }
  })
