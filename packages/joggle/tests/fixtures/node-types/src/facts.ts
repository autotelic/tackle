export interface Base {
  id: string
  label: string
}

export interface Composed {
  base: Base
  pair: Base & { extra: number }
  optional: Partial<Base>
}

export type Picked = {
  label: Composed["base"]["label"]
  id: Base["id"]
}

export type Variants =
  | { kind: "a"; a: number }
  | { kind: "b"; b: string }

export const ROLES = ["admin", "owner"] as const
export const KIND = "admin" as const

// Two declarations the compiler proves identical, written in a different order.
export interface Alpha {
  x: number
  y: string
}

export interface Beta {
  y: string
  x: number
}

// Not identical: one is a subset of the other.
export interface Wide {
  a: string
  b: number
}

export interface Derived extends Base {
  extra: boolean
}

export type Alias = Base

export interface Box<T> {
  value: T
}

export type Wrapped = Box<Base>

export interface Narrow {
  a: string
}

// Two vocabularies that share a field name and a path. Telling them apart means
// comparing the VALUES, which the annotation text cannot see.
export const PROJECT_ROLES = ["viewer", "owner"] as const
export const CREW_ROLES = ["viewer", "owner", "admin"] as const

export interface ProjectSummary {
  crewRole: (typeof PROJECT_ROLES)[number]
  title: string
}

export interface CrewAssignment {
  crewRole: (typeof CREW_ROLES)[number]
  since: string
}
