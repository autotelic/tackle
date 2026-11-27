import type { Effect } from "effect"

export interface Narrow {
  a: string
}

export interface Wide {
  a: string
  b?: number
}

// Two generic aliases that differ only in the parameter's NAME.
export type Box<A> = { value: A }
export type Cell<T> = { value: T }

// A recursive type: the canonical walk must terminate and stay stable.
export type Tree = { children: Tree[] }

// Two programs whose scaffolding agrees and whose ERROR channel does not. This
// is the case canonical type identity exists for.
export type OkProgram = Effect.Effect<string, never, never>
export type FailedProgram = Effect.Effect<string, Error, never>
