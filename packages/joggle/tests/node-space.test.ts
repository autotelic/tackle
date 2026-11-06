import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace } from "../src/workspace.ts"

/**
 * Every declaration form a codebase actually writes, as a unit.
 *
 * The census is the point: a rule that silently receives fewer candidates is a
 * rule nobody can debug, so the fact that a schema, a vocabulary table, an enum
 * and a class are all addressable is asserted here rather than assumed.
 */
it.effect("a schema, a vocabulary, an enum, a class and a union are all units", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/node-space", ["src"])
    const units = workspace.units
    const byName = (name: string) => units.find((unit) => unit.name === name)

    // A const whose initializer is a call: the schema idiom, and the rule table.
    expect(byName("PersonSchema")?.kind).toBe("const")
    expect(byName("personRule")?.kind).toBe("const")
    // A vocabulary keeps its values, and only because every element is a literal.
    expect(byName("ROLES")?.values).toEqual(["admin", "owner", "viewer"])
    expect(byName("LIMITS")?.values).toEqual(["1", "2", "3"])
    expect(byName("FLAGS")?.values).toEqual(["true", "false"])
    // A schema built from calls has no literal set, and must not pretend to.
    expect(byName("PersonSchema")?.values).toEqual([])

    // An enum is a unit, and its members are its vocabulary.
    expect(byName("Status")?.kind).toBe("enum")
    expect(byName("Status")?.values).toEqual(["active", "paused"])

    // A class is a unit of its own, beside its methods.
    const person = byName("Person")
    expect(person?.kind).toBe("class")
    expect(person?.fieldTypes.get("name")).toBe("string")
    expect(byName("Person.greet")?.kind).toBe("function")

    // A union carries variants instead of an empty field set.
    const variants = byName("Variants")
    expect(variants?.kind).toBe("type")
    expect(variants?.variants.length).toBe(2)
    expect(variants?.variants.join(" ")).toContain("kind")
    // A mapped type carries the keys it ranges over.
    expect(byName("Flags")?.variants.length).toBe(2)
    // A conditional alias is still a unit, even with no field set.
    expect(byName("Conditional")?.kind).toBe("type")

    // "typed" means the declaration WRITES a type, including a keyword type. The
    // old flag was "mentions a named type", so a fully annotated one-liner read
    // as untyped and the shape-only caveat was wrong about it.
    expect(byName("trimmed")?.typed).toBe(true)
    expect(byName("passThrough")?.typed).toBe(false)
    expect(byName("Person.greet")?.typed).toBe(true)
    expect(byName("ROLES")?.typed).toBe(true)
  }).pipe(Effect.provide(NodeServices.layer)),
)
