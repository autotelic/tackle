import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { messages, locator, reporter } from "../src/reporting.ts"
import { RuleAuthoringError } from "../src/schema.ts"
import { loadWorkspace } from "../src/workspace.ts"

const registry = messages({
  drift: "{{name}} drifted from {{other}}.",
  bare: "A bare message.",
})

const rule = {
  id: "test/reporting",
  severity: "warn" as const,
  judged: false,
  messages: registry,
}

it("a message is one declaration, filled from data", () => {
  const report = reporter(rule, () => ({ file: "x.ts", line: 1, column: 1 }))
  const diagnostic = report({ about: { file: "x.ts", start: 0 }, messageId: "drift", data: { name: "A", other: "B" } })
  expect(diagnostic.message).toBe("A drifted from B.")
  expect(diagnostic.severity).toBe("warn")
  expect(diagnostic.judged).toBe(false)
})

it("reporting an undeclared message id is a rule bug, and says so", () => {
  const report = reporter(rule, () => ({ file: "x.ts", line: 1, column: 1 }))
  expect(() => report({ about: { file: "x.ts", start: 0 }, messageId: "missing" })).toThrow(
    RuleAuthoringError,
  )
})

it("a template that needs data it was not given says so", () => {
  const report = reporter(rule, () => ({ file: "x.ts", line: 1, column: 1 }))
  expect(() =>
    report({ about: { file: "x.ts", start: 0 }, messageId: "drift", data: { name: "A" } }),
  ).toThrow(RuleAuthoringError)
})

it.effect("a span resolves to its real line and column, not line 1", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/types-over-logic", ["src"])
    const locate = locator(workspace)
    const file = workspace.files.find((candidate) => candidate.path.endsWith("handlers.ts"))
    expect(file).toBeDefined()
    if (file === undefined) return
    const text = file.text
    // The `throw new Error("no email")` line, found by its own text so the test
    // does not depend on the fixture's line number staying fixed.
    const offset = text.indexOf('throw new Error("no email")')
    const expectedLine = text.slice(0, offset).split("\n").length
    const location = locate({ file: file.path, start: offset })
    expect(location.line).toBe(expectedLine)
    expect(location.column).toBe(offset - text.lastIndexOf("\n", offset - 1))
    expect(location.line).toBeGreaterThan(1)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a unit reports at its own location, a file at its start", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/types-over-logic", ["src"])
    const locate = locator(workspace)
    const unit = workspace.units[0]
    expect(unit).toBeDefined()
    if (unit === undefined) return
    const location = locate(unit)
    // The locator must not move a declaration that already knows where it is.
    expect(location).toEqual(unit.location)
    const file = workspace.files[0]
    expect(file).toBeDefined()
    if (file === undefined) return
    expect(locate(file)).toEqual({ file: file.path, line: 1, column: 1 })
  }).pipe(Effect.provide(NodeServices.layer)),
)
