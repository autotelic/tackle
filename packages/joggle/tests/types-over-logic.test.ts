import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { typesOverLogic } from "../src/rules/types-over-logic.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { indexOf, type TypeFact } from "../src/typetrace.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * The two facts the rule reads: an AST guard whose branch leaves the function,
 * and the CHECKER's resolved type for the value it guards. A guard on a value
 * the checker left wide is a candidate; what it means is the question.
 */
const fact = (
  display: string,
  flags: ReadonlyArray<string>,
  members: ReadonlyArray<string> = [],
): TypeFact => ({
  display,
  symbol: "",
  flags,
  arguments: [],
  members,
  origin: { file: "src/handlers.ts", line: 1 },
})

// The lines are out of range on purpose: `at` tries the declaration site first,
// and a synthetic line that collided with a real unit resolved the wrong fact.
const types = indexOf([
  { file: "src/handlers.ts", line: 901, name: "email", fact: fact("string", ["String"]) },
  { file: "src/handlers.ts", line: 902, name: "raw", fact: fact("unknown", ["Unknown"]) },
  {
    file: "src/handlers.ts",
    line: 903,
    name: "user",
    fact: fact("{ name: String } | undefined", ["Union"], ["{ name: String }", "undefined"]),
  },
])

const fixture = () =>
  loadWorkspace("tests/fixtures/types-over-logic", ["src"], { types })

it.effect("guards on values the checker left wide are the candidates", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(typesOverLogic, workspace)
    expect(result.diagnostics.length).toBe(3)
    const messages = result.diagnostics.map((entry) => entry.message)
    expect(messages.some((message) => message.includes("email") && message.includes("string"))).toBe(true)
    expect(messages.some((message) => message.includes("raw") && message.includes("unknown"))).toBe(true)
    expect(result.diagnostics.every((entry) => entry.move === "expand")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("type_should_carry_it", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a guard the model reads as the boundary is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(typesOverLogic, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("parse boundary"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("boundary_check", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
