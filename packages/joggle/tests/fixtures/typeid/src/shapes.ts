// A three-parameter type, written here rather than imported: the canonical id
// is the subject, and it must not depend on the library's display text.
export interface Effect<A, E, R> {
  readonly _A: A
  readonly _E: E
  readonly _R: R
}

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
export type OkProgram = Effect<string, never, never>
export type FailedProgram = Effect<string, Error, never>
