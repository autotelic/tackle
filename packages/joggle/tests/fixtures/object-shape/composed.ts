export interface Base {
  x: number
  y: number
}

// A type composed from another. Its field set is Base's plus its own, and a
// literal that matches the composed set is a use of it -- not a shape nobody
// named. Without resolving `extends`, this rule reported exactly the literals
// that composing the type produced.
export interface Labelled extends Base {
  label: string
}

export const one = { x: 1, y: 2, label: "a" }
