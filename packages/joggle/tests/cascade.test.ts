import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { cascadeOf } from "../src/cascade.ts"
import { loadWorkspace } from "../src/workspace.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

const load = () => loadWorkspace("tests/fixtures/cascade", ["src"])

/**
 * Two merges, which is the real shape: the duplicated interface collapses into
 * the one in a.ts, and the duplicated function collapses into its own namesake.
 * A cascade is computed per survivor, because the survivor is what the sites
 * must name afterwards.
 */
test("a merge cascade lists the imports, the call site and the type name", async () => {
  const edits = await run(
    Effect.gen(function* () {
      const workspace = yield* load()
      const at = (file: string, name: string) =>
        workspace.units.find((unit) => unit.file === file && unit.name === name)!
      return [
        ...cascadeOf(workspace, at("src/a.ts", "loadTask"), [at("src/dup.ts", "loadTask")]),
        ...cascadeOf(workspace, at("src/a.ts", "Task"), [at("src/dup.ts", "Task")]),
      ]
    }),
  )

  // 1. The imports: b.ts takes the function and the type from the dropped file.
  const imports = edits.filter((edit) => edit.instruction.startsWith("import"))
  expect(imports.map((edit) => edit.file)).toEqual(["src/b.ts", "src/b.ts"])
  expect(imports[0]?.instruction).toContain("loadTask")
  expect(imports[1]?.instruction).toContain("Task")

  // 2. The call site, with the line the call is on.
  const calls = edits.filter((edit) => edit.instruction.startsWith("call"))
  expect(calls.map((edit) => edit.file + ":" + edit.line)).toEqual(["src/b.ts:9"])

  // 3. The type names: the one in b.ts, and the dropped file's own use of it.
  const types = edits.filter((edit) => edit.instruction.includes("now resolves"))
  expect(types.map((edit) => edit.file + ":" + edit.line)).toEqual(["src/b.ts:4", "src/dup.ts:7"])

  // The order is the order a person would make the edits, per survivor.
  expect(edits.length).toBe(5)
})

test("a declaration nothing refers to has an empty cascade", async () => {
  const edits = await run(
    Effect.gen(function* () {
      const workspace = yield* load()
      const keep = workspace.units.find((unit) => unit.file === "src/dup.ts" && unit.name === "loadTask")
      const drop = workspace.units.find((unit) => unit.file === "src/a.ts" && unit.name === "firstTask")
      return cascadeOf(workspace, keep!, [drop!])
    }),
  )
  // Nothing names firstTask, so the merge is free, and an empty cascade is the
  // honest answer rather than a repair with invented sites.
  expect(edits).toEqual([])
})

test("the cascade is deduplicated", async () => {
  const edits = await run(
    Effect.gen(function* () {
      const workspace = yield* load()
      const keep = workspace.units.find((unit) => unit.file === "src/a.ts" && unit.name === "loadTask")
      const drop = workspace.units.find((unit) => unit.file === "src/dup.ts" && unit.name === "loadTask")
      // The same drop twice: the same edits, once.
      return cascadeOf(workspace, keep!, [drop!, drop!])
    }),
  )
  const keys = edits.map((edit) => [edit.file, edit.line, edit.instruction].join("|"))
  expect(new Set(keys).size).toBe(keys.length)
})
