/** A base to be composed, and a type that lists all of it and adds one. */
export interface Base {
  x: number
  y: number
  z: number
  label: string
}

export interface Extended {
  x: number
  y: number
  z: number
  label: string
  extra: boolean
}
