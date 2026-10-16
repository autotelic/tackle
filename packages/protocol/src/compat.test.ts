import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { schemaBreakingChanges } from "./compat.ts"
import { compileLexicon, fixturePath, loadJson, makeAjv } from "./fixture-support.ts"
import type { LexiconName } from "./lexicon.ts"

describe("schemaBreakingChanges", () => {
  it("allows adding an optional field", () => {
    const previous = { type: "object", properties: { a: { type: "string" } } }
    const next = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } }
    expect(schemaBreakingChanges(previous, next)).toEqual([])
  })

  it("fails when a field is newly required", () => {
    const previous = { type: "object", properties: { a: { type: "string" } } }
    const next = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" } },
    }
    expect(schemaBreakingChanges(previous, next)).toHaveLength(1)
  })

  it("fails when a named property is removed and extras are closed", () => {
    const previous = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" }, b: { type: "string" } },
    }
    const next = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    }
    expect(schemaBreakingChanges(previous, next)).toHaveLength(1)
  })

  it("allows removing a property when extras are still open", () => {
    const previous = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
    }
    const next = {
      type: "object",
      additionalProperties: true,
      properties: { a: { type: "string" } },
    }
    expect(schemaBreakingChanges(previous, next)).toEqual([])
  })

  it("fails when an enum loses a value", () => {
    const previous = { enum: ["error", "warn", "info"] }
    const next = { enum: ["error", "warn"] }
    expect(schemaBreakingChanges(previous, next)).toHaveLength(1)
  })

  it("allows integer widening to number, fails the reverse", () => {
    expect(schemaBreakingChanges({ type: "integer" }, { type: "number" })).toEqual([])
    expect(schemaBreakingChanges({ type: "number" }, { type: "integer" })).toHaveLength(1)
  })

  it("fails when additionalProperties closes from an implicit open", () => {
    const previous = { type: "object", properties: { a: { type: "string" } } }
    const next = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    }
    expect(schemaBreakingChanges(previous, next)).toHaveLength(1)
  })
})

/*
 * The corpus is the guarantee the structural check cannot give: these are records that
 * were valid when they were frozen, and the current schemas must still accept every one.
 * A schema change that fails here is the exact failure the evolution rule exists to stop.
 */
const corpus = readdirSync(fixturePath("fixtures/compat")).filter((file) => file.endsWith(".json"))

describe("the frozen corpus", () => {
  it("has a record for every lexicon", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(8)
  })

  it.each(corpus)("still validates %s against the current schema", (file) => {
    const lexicon = file.replace(/\.json$/u, "").replace(/\.v\d+$/u, "") as LexiconName
    const validate = compileLexicon(makeAjv(), lexicon)
    const ok = validate(loadJson(`fixtures/compat/${file}`))
    if (!ok) throw new Error(JSON.stringify(validate.errors))
    expect(ok).toBe(true)
  })
})
