import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace } from "../src/workspace.ts"

it.effect("the AST facts carry string construction and guard shapes", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/facts", ["src"])
    const file = workspace.files[0]
    expect(file).toBeDefined()
    if (file === undefined) return

    // A template literal is a string site, with the references it interpolates.
    const template = file.facts.stringSites.find((site) => site.refs.includes("amount.toFixed"))
    expect(template).toBeDefined()
    expect(template?.refs).toContain("total")

    // A `+` with a string literal on one side is a string site too.
    expect(file.facts.stringSites.some((site) => site.refs.includes("total"))).toBe(true)

    // A guard clause is an `if` whose branch returns, with the refs it names.
    const guard = file.facts.guards.find((site) => site.refs.includes("amount"))
    expect(guard).toBeDefined()
    expect(guard?.exits).toBe(true)
  }).pipe(Effect.provide(NodeServices.layer)),
)
