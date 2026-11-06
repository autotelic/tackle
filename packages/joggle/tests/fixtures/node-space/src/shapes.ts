import { Schema } from "effect"

const defineRule = (spec: unknown): unknown => spec

export const PersonSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
})

export const personRule = defineRule({ name: "person", check: () => [] })

export const ROLES = ["admin", "owner", "viewer"] as const

export const LIMITS = [1, 2, 3]

export const FLAGS = { a: true, b: false } as const

export enum Status {
  Active = "active",
  Paused = "paused",
}

export class Person {
  name: string = ""
  constructor(public id: string) {}
  greet(): string {
    return this.name
  }
}

export type Variants =
  | { kind: "a"; a: number }
  | { kind: "b"; b: string }

export type Flags = { [K in "a" | "b"]: boolean }

export type Conditional<T> = T extends string ? "yes" : "no"

export const trimmed = (value: string): string => value.trim()
export const passThrough = (value) => value
