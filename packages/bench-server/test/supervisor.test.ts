import { expect, test } from "vitest"
import { Effect, Exit, Queue, Ref } from "effect"
import { supervise, ShopBusy, type ChildSpec } from "../src/Supervisor.ts"

const counts = () => Effect.runSync(Ref.make<Record<string, number>>({}))

const spec = (name: string, counter: Ref.Ref<Record<string, number>>): ChildSpec => ({
  name,
  start: Ref.update(counter, (c) => ({ ...c, [name]: (c[name] ?? 0) + 1 })).pipe(
    Effect.andThen(Effect.never),
  ),
})

const run = <A, E>(effect: Effect.Effect<A, E, import("effect/Scope").Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

test("one_for_one restarts only the crashed child", () =>
  run(
    Effect.gen(function* () {
      const counter = yield* Ref.make<Record<string, number>>({})
      const handle = yield* supervise({ shop: "one", strategy: "one_for_one" }, [
        spec("a", counter),
        spec("b", counter),
      ])
      yield* Effect.sleep("10 millis")
      expect(yield* Ref.get(counter)).toEqual({ a: 1, b: 1 })
      yield* handle.crash("a")
      yield* Effect.sleep("20 millis")
      expect(yield* Ref.get(counter)).toEqual({ a: 2, b: 1 })
      yield* handle.stop()
    }),
  ))

test("rest_for_one restarts the crashed child and everything started after it", () =>
  run(
    Effect.gen(function* () {
      const counter = yield* Ref.make<Record<string, number>>({})
      const handle = yield* supervise({ shop: "rest", strategy: "rest_for_one" }, [
        spec("a", counter),
        spec("b", counter),
        spec("c", counter),
      ])
      yield* Effect.sleep("10 millis")
      yield* handle.crash("a")
      yield* Effect.sleep("20 millis")
      expect(yield* Ref.get(counter)).toEqual({ a: 2, b: 2, c: 2 })
      yield* handle.stop()
    }),
  ))

test("intensity exceeded stops the tree and writes one desk item", () =>
  run(
    Effect.gen(function* () {
      const counter = yield* Ref.make<Record<string, number>>({})
      const handle = yield* supervise({ shop: "intense", maxRestarts: 1, periodMs: 60_000 }, [
        spec("a", counter),
      ])
      yield* handle.crash("a")
      yield* Effect.sleep("20 millis")
      yield* handle.crash("a")
      yield* Effect.sleep("20 millis")
      const status = yield* handle.status()
      expect(status.blocked).toBe(true)
      const item = yield* Queue.take(handle.desk)
      expect(item.reason).toBe("crash-looping")
      expect(item.child).toBe("a")
      yield* handle.stop()
    }),
  ))

test("a shop has one supervisor", () =>
  run(
    Effect.gen(function* () {
      const counter = yield* Ref.make<Record<string, number>>({})
      yield* supervise({ shop: "only" }, [spec("a", counter)])
      const second = yield* Effect.exit(supervise({ shop: "only" }, [spec("b", counter)]))
      expect(Exit.isFailure(second)).toBe(true)
      if (Exit.isFailure(second)) expect(String(second.cause)).toContain("already has a supervisor")
    }),
  ))
