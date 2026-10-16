import { expect, test } from "vitest"
import { Effect } from "effect"
import { oneConceptOneType } from "../src/rules/one-concept-one-type.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { emptyTypeIndex, indexOf, parseTrace } from "../src/typetrace.ts"
import { choice, modelStub } from "./support.ts"
import type { Unit, Workspace } from "../src/workspace.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

/** A declaration with only the fields this rule reads. */
const declared = (name: string, file: string, line: number, display: string, exported = true): Unit =>
  ({
    kind: "interface",
    name,
    file,
    exported,
    location: { file, line, column: 1 },
    typeFacts: {
      display,
      symbol: name,
      flags: ["Object"],
      arguments: [],
      members: [],
      origin: { file, line },
    },
  }) as unknown as Unit

const workspaceOf = (units: ReadonlyArray<Unit>): Workspace =>
  ({ units, types: emptyTypeIndex }) as unknown as Workspace

const review = (units: ReadonlyArray<Unit>) =>
  plannedDiagnosticsOf(oneConceptOneType, workspaceOf(units)).pipe(
    Effect.provide(modelStub({ verdict: choice("one_concept", 0.95) })),
  )

test("one exported name resolving to two types is one finding", async () => {
  const result = await run(
    review([
      declared("User", "src/api.ts", 3, "{ id: String }"),
      declared("User", "src/ui.ts", 5, "{ id: String; name: String }"),
    ]),
  )
  expect(result.diagnostics.length).toBe(1)
  expect(result.diagnostics[0]?.message).toContain("2 different types")
  expect(result.diagnostics[0]?.message).toContain("2 file(s)")
  expect(result.diagnostics[0]?.help).toContain("src/api.ts:3")
  expect(result.diagnostics[0]?.help).toContain("src/ui.ts:5")
  expect(result.diagnostics[0]?.judged).toBe(true)
})

test("one name written identically twice is not a finding", async () => {
  const result = await run(
    review([
      declared("User", "src/api.ts", 3, "{ id: String }"),
      declared("User", "src/ui.ts", 5, "{ id: String }"),
    ]),
  )
  expect(result.diagnostics.length).toBe(0)
})

test("a file-local name is not a contract", async () => {
  const result = await run(
    review([
      declared("Row", "src/api.ts", 3, "{ id: String }", false),
      declared("Row", "src/ui.ts", 5, "{ name: String }", false),
    ]),
  )
  expect(result.diagnostics.length).toBe(0)
})

test("one name in one file is not a finding", async () => {
  const result = await run(
    review([
      declared("User", "src/api.ts", 3, "{ id: String }"),
      declared("User", "src/api.ts", 9, "{ name: String }"),
    ]),
  )
  expect(result.diagnostics.length).toBe(0)
})

test("a run without a trace says so rather than reporting agreement", async () => {
  const result = await run(review([]))
  expect(result.diagnostics.length).toBe(0)
  expect(result.notes.join(" ")).toContain("--types")
})

test("a real trace index drives the rule", () => {
  const index = indexOf(
    parseTrace("/r", [
      [
        { id: 1, display: "{ id: String }", symbolName: "User", flags: ["Object"], firstDeclaration: { path: "/r/src/a.ts", start: { line: 2, character: 1 } } },
        { id: 2, display: "{ name: String }", symbolName: "User", flags: ["Object"], firstDeclaration: { path: "/r/src/b.ts", start: { line: 4, character: 1 } } },
      ],
    ]),
  )
  expect(index.at("src/a.ts", 2, "User")?.display).toBe("{ id: String }")
  expect(index.at("src/b.ts", 4, "User")?.display).toBe("{ name: String }")
})
