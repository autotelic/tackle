import { expect, test } from "vitest"
import { Effect } from "effect"
import { structuralCollapse } from "../src/rules/structural-collapse.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { choice, modelStub } from "./support.ts"
import type { Unit, Workspace } from "../src/workspace.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

/** A declaration with only the fields this rule reads. */
const declared = (
  name: string,
  file: string,
  group: string | null,
  kind: Unit["kind"] = "interface",
): Unit =>
  ({
    kind,
    name,
    file,
    start: 0,
    location: { file, line: 1, column: 1 },
    typeFacts: {
      display: "{ id: string }",
      structural: "object{id:string}",
      flags: ["Object"],
      members: [{ name: "id", type: "string", variants: [] }],
      variants: [],
      bases: [],
      alias: null,
      value: null,
      identicalGroup: group,
      truncated: false,
    },
  }) as unknown as Unit

const review = (units: ReadonlyArray<Unit>, verdict: "one_concept" | "two_concepts" = "one_concept") =>
  plannedDiagnosticsOf(structuralCollapse, { units } as unknown as Workspace).pipe(
    Effect.provide(modelStub({ verdict: choice(verdict, 0.95) })),
  )

test("two names the compiler proves identical are one finding", async () => {
  const result = await run(
    review([declared("User", "src/api.ts", "g1"), declared("Account", "src/ui.ts", "g1")]),
  )
  expect(result.diagnostics.length).toBe(1)
  expect(result.diagnostics[0]?.message).toContain("User")
  expect(result.diagnostics[0]?.message).toContain("Account")
  expect(result.diagnostics[0]?.help).toContain("object{id:string}")
  expect(result.diagnostics[0]?.judged).toBe(true)
})

test("the judgement can say the names are two concepts", async () => {
  const result = await run(
    review(
      [declared("User", "src/api.ts", "g1"), declared("Account", "src/ui.ts", "g1")],
      "two_concepts",
    ),
  )
  expect(result.diagnostics.length).toBe(0)
  expect(result.drops.map((drop) => drop.reason).join(" ")).toContain("two concepts")
})

test("one-way assignability is not a collapse", async () => {
  // A subset and a superset are different groups: no proof, no finding.
  const result = await run(
    review([declared("Wide", "src/api.ts", null), declared("Narrow", "src/ui.ts", null)]),
  )
  expect(result.diagnostics.length).toBe(0)
})

test("one name declared twice belongs to duplicate-implementation", async () => {
  const result = await run(
    review([declared("User", "src/api.ts", "g1"), declared("User", "src/ui.ts", "g1")]),
  )
  expect(result.diagnostics.length).toBe(0)
})

test("a class and a type alias under two names can collapse", async () => {
  const result = await run(
    review([
      declared("Person", "src/domain.ts", "g2", "class"),
      declared("PersonRow", "src/db.ts", "g2", "type"),
    ]),
  )
  expect(result.diagnostics.length).toBe(1)
})
