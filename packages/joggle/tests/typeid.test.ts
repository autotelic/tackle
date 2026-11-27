import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { identityKeysOf } from "../src/identity.ts"
import { resolveDeclarations, type ResolvedType } from "../src/typefacts.ts"
import { loadWorkspace } from "../src/workspace.ts"

const root = resolve(import.meta.dirname, "fixtures/typeid")
const tsconfig = "tsconfig.json"

const declaration = (file: string, marker: string, name: string) => {
  const text = readFileSync(join(root, file), "utf8")
  const start = text.indexOf(marker)
  if (start === -1) throw new Error("declaration not found: " + marker)
  return { file, position: start + marker.indexOf(name) }
}

const REQUESTS = [
  declaration("src/left.ts", "interface Person", "Person"),
  declaration("src/right.ts", "interface Customer", "Customer"),
  declaration("src/shapes.ts", "interface Narrow", "Narrow"),
  declaration("src/shapes.ts", "interface Wide", "Wide"),
  declaration("src/shapes.ts", "type Box", "Box"),
  declaration("src/shapes.ts", "type Cell", "Cell"),
  declaration("src/shapes.ts", "type Tree", "Tree"),
  declaration("src/shapes.ts", "type OkProgram", "OkProgram"),
  declaration("src/shapes.ts", "type FailedProgram", "FailedProgram"),
] as const

const factsByName = (
  facts: ReadonlyArray<{ file: string; position: number; facts: ResolvedType }>,
) => {
  const out = new Map<string, ResolvedType>()
  for (const request of REQUESTS) {
    const entry = facts.find(
      (candidate) => candidate.file === request.file && candidate.position === request.position,
    )
    if (entry === undefined) throw new Error("no facts for " + request.file)
    out.set(String(request.position), entry.facts)
  }
  return (request: (typeof REQUESTS)[number]): ResolvedType => {
    const facts = out.get(String(request.position))
    if (facts === undefined) throw new Error("no facts for " + request.file)
    return facts
  }
}

const resolveFixture = () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(root, ["."])
    const identity = identityKeysOf({ workspace, root })
    const result = yield* Effect.tryPromise(() =>
      resolveDeclarations({
        cwd: root,
        tsconfig,
        requests: [...REQUESTS],
        identity,
        maxMembers: 64,
        maxStrings: 12000,
        canonical: true,
      }),
    )
    return factsByName(result.found)
  }).pipe(Effect.provide(NodeServices.layer))

describe("canonical type identity", () => {
  it.effect(
    "two identical object types in different modules share one id, whatever they are called",
    () =>
      Effect.gen(function* () {
        const facts = yield* resolveFixture()
        const person = facts(REQUESTS[0])
        const customer = facts(REQUESTS[1])
        expect(person.display).toBe("Person")
        expect(customer.display).toBe("Customer")
        expect(person.canonical).toBe(customer.canonical)
      }),
    120000,
  )

  it.effect(
    "an optional member changes the id, and the member sets report the relation",
    () =>
      Effect.gen(function* () {
        const facts = yield* resolveFixture()
        const narrow = facts(REQUESTS[2])
        const wide = facts(REQUESTS[3])
        expect(narrow.canonical).not.toBe(wide.canonical)
        expect(narrow.members.map((member) => member.name)).toEqual(["a"])
        expect(wide.members.map((member) => member.name)).toEqual(["a", "b"])
        // The relation is a fact a caller can report: Wide is Narrow plus `b?`.
        expect(wide.members.map((member) => member.name)).toEqual(
          expect.arrayContaining(narrow.members.map((member) => member.name)),
        )
      }),
    120000,
  )

  it.effect(
    "a type parameter is a position, so Box<A> and Cell<T> have the same canonical id",
    () =>
      Effect.gen(function* () {
        const facts = yield* resolveFixture()
        expect(facts(REQUESTS[4]).canonical).toBe(facts(REQUESTS[5]).canonical)
      }),
    120000,
  )

  it.effect(
    "a recursive type terminates and keeps the same id across a re-run",
    () =>
      Effect.gen(function* () {
        const first = yield* resolveFixture()
        const second = yield* resolveFixture()
        const tree = first(REQUESTS[6])
        expect(tree.canonical.length).toBeGreaterThan(0)
        expect(tree.canonical).toBe(second(REQUESTS[6]).canonical)
      }),
    240000,
  )

  it.effect(
    "two Effect programs differing only in the error channel have different ids",
    () =>
      Effect.gen(function* () {
        const facts = yield* resolveFixture()
        const ok = facts(REQUESTS[7])
        const failed = facts(REQUESTS[8])
        expect(ok.canonical).not.toBe(failed.canonical)
      }),
    120000,
  )
})
