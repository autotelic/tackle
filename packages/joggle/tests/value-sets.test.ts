import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { fieldTypeDrift } from "../src/rules/field-type-drift.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { declarationKey, resolveDeclarations } from "../src/typefacts.ts"
import { applyDeclarationTypes, loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const root = "tests/fixtures/node-types"

describe("the field rules read the compiler", () => {
  it.effect(
    "two vocabularies sharing a field name are separated by their value sets",
    () =>
      Effect.gen(function* () {
        const workspace = yield* loadWorkspace("tests/fixtures/node-types", ["src"])
        const units = workspace.units.filter(
          (unit) => unit.name === "ProjectSummary" || unit.name === "CrewAssignment",
        )
        expect(units.length).toBe(2)

        const resolved = yield* Effect.tryPromise(() =>
          resolveDeclarations({
            cwd: root,
            tsconfig: "tsconfig.json",
            maxMembers: 64,
            maxStrings: 12000,
            requests: units.map((unit) => ({ file: unit.file, position: unit.namePosition })),
          }),
        )
        const index = new Map(
          resolved.found.map((entry) => [declarationKey(entry.file, entry.position), entry.facts]),
        )
        applyDeclarationTypes(workspace, index)

        // The fact layer proved each field's value set, so the rule can name it.
        const project = workspace.units.find((unit) => unit.name === "ProjectSummary")
        const member = project?.typeFacts?.members.find((entry) => entry.name === "crewRole")
        expect(member?.variants.length).toBe(2)
        const crew = workspace.units.find((unit) => unit.name === "CrewAssignment")
        expect(crew?.typeFacts?.members.find((entry) => entry.name === "crewRole")?.variants.length).toBe(3)

        const result = yield* plannedDiagnosticsOf(fieldTypeDrift, workspace).pipe(
          Effect.provide(modelStub({ verdict: choice("drift", 0.95) })),
        )
        const finding = result.diagnostics.find((entry) =>
          (entry.message ?? "").includes("crewRole"),
        )
        expect(finding).toBeDefined()
        // It is the VALUE sentence, not the type sentence: the two annotations are
        // different aliases, and only the values say how.
        expect(finding?.message).toContain("allows")
        expect(finding?.message).toContain("viewer")
        expect(finding?.message).toContain("admin")
        expect(finding?.help).toContain("value sets differ")
      }).pipe(Effect.provide(NodeServices.layer)),
    120000,
  )
})
