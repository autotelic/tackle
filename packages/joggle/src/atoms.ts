import { Context, Effect, Layer, Ref, Schema } from "effect"
import { canonical } from "./canonical.ts"
import { shortHash } from "./state.ts"

/**
 * The id of a fact: its content, hashed.
 *
 * Content-addressed rather than positional, and that is the whole point. The same
 * declaration is the same atom in every rule and every run, so two rules that
 * judge it send it once, and a question's answer can be cached against the atoms
 * it referenced rather than against whichever request happened to carry them.
 *
 * A positional id (`a0`, `a1`) would make the id depend on the order rules ran,
 * which is exactly the instability a cache cannot survive.
 */
export const atomId = (value: Schema.Json): string => "a" + shortHash(canonical(value))

/**
 * One declaration offered to the model, bounded.
 *
 * The same four fields every rule sends when it names a member: which
 * declaration, where, and a slice of its source. Declared as a Schema so it is
 * JSON by construction -- an atom's value must be.
 */
export const CandidateSample = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  line: Schema.Finite,
  source: Schema.String,
})

export type CandidateSample = typeof CandidateSample.Type

export interface Interface {
  /** Add a fact and return its id. The same value returns the same id. */
  readonly add: (value: Schema.Json) => Effect.Effect<string>
  /** Add several, in order. */
  readonly addAll: (values: ReadonlyArray<Schema.Json>) => Effect.Effect<ReadonlyArray<string>>
  /** The facts behind these ids, keyed by id, for one request's state. */
  readonly values: (ids: ReadonlyArray<string>) => Effect.Effect<Record<string, Schema.Json>>
  /** How many distinct facts this run has added. */
  readonly size: Effect.Effect<number>
}

/**
 * The shared facts a run's questions are built from.
 *
 * One store for the whole run, so every rule derives a declaration's state from
 * the same place. The value of that is not only fewer bytes: it is that two rules
 * cannot disagree about what a declaration's resolved type is, because there is
 * one atom and one id for it.
 *
 * A `Ref` and not a mutable map, because rules run concurrently and two of them
 * may add the same atom at once.
 */
export class Atoms extends Context.Service<Atoms, Interface>()("@joggle/Atoms") {}

export const layer: Layer.Layer<Atoms> = Layer.effect(
  Atoms,
  Effect.gen(function* () {
    const store = yield* Ref.make<ReadonlyMap<string, Schema.Json>>(new Map())

    const add = Effect.fn("Atoms.add")(function* (value: Schema.Json) {
      const id = atomId(value)
      yield* Ref.update(store, (current) => {
        if (current.has(id)) return current
        const next = new Map(current)
        next.set(id, value)
        return next
      })
      return id
    })

    const addAll = Effect.fn("Atoms.addAll")(function* (values: ReadonlyArray<Schema.Json>) {
      const ids: Array<string> = []
      for (const value of values) ids.push(yield* add(value))
      return ids
    })

    return Atoms.of({
      add,
      addAll,
      values: Effect.fn("Atoms.values")(function* (ids: ReadonlyArray<string>) {
        const current = yield* Ref.get(store)
        const out: Record<string, Schema.Json> = {}
        for (const id of ids) {
          const value = current.get(id)
          if (value !== undefined) out[id] = value
        }
        return out
      }),
      size: Effect.map(Ref.get(store), (current) => current.size),
    })
  }),
)
