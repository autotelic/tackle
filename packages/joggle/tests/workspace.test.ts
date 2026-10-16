import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace, tokenize } from "../src/workspace.ts"
import { similarity } from "../src/similarity.ts"

const corpus = "tests/fixtures/corpus"

it.effect("indexes the declarations the compiler would see", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(corpus, ["src"])
    expect(workspace.files.length).toBe(2)
    const names = workspace.units.map((unit) => unit.name)
    expect(names).toContain("findUserById")
    expect(names).toContain("lookupUserById")
    expect(names).toContain("Order")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("paths are relative to the root so diagnostics are stable", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(corpus, ["src"])
    for (const file of workspace.files) {
      expect(file.path.startsWith("src/")).toBe(true)
    }
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("identical implementations share a shape hash", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(corpus, ["src"])
    const find = workspace.units.find((unit) => unit.name === "findUserById")
    const lookup = workspace.units.find((unit) => unit.name === "lookupUserById")
    expect(find).toBeDefined()
    expect(lookup).toBeDefined()
    expect(find?.shapeHash).toBe(lookup?.shapeHash)
    expect(similarity(find?.tokens ?? [], lookup?.tokens ?? [])).toBe(1)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it("normalisation keeps types and literals, drops names", () => {
  const tokens = tokenize("function _(a: number) { return _.total > 0 }")
  expect(tokens).toContain("number")
  expect(tokens).toContain(">")
  expect(tokens).toContain("0")
})

it("similarity falls off for different structures", () => {
  const a = tokenize("{ return _.filter((_) => _.name.length > 0) }")
  const b = tokenize("{ return _.map((_) => _.name) }")
  const score = similarity(a, b)
  expect(score).toBeGreaterThan(0)
  expect(score).toBeLessThan(1)
})
