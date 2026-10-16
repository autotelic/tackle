import { expect, it } from "@effect/vitest"
import { Effect, Path } from "effect"
import { buildImportGraph, resolveSpecifier } from "../src/imports.ts"

const known = new Set(["src/types.ts", "src/utils/index.ts", "app/lib/helpers.ts"])

/** Structure facts are irrelevant to import resolution; only the shape matters. */
const empty = { callSites: [], jsx: [], objects: [], columns: [], stringSites: [], guards: [], skips: [], literals: [], allOptionalFunctions: [], returns: [], comparisons: [] }

it.effect("relative specifiers resolve exactly, including index files", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    expect(resolveSpecifier({ from: "src/a.ts", specifier: "./types", known, path })).toBe("src/types.ts")
    expect(resolveSpecifier({ from: "src/deep/b.ts", specifier: "../types", known, path })).toBe("src/types.ts")
    expect(resolveSpecifier({ from: "src/a.ts", specifier: "./utils", known, path })).toBe("src/utils/index.ts")
  }).pipe(Effect.provide(Path.layer)),
)

it.effect("a bundler root alias resolves by walking up from the importer", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    expect(resolveSpecifier({ from: "app/routes/x.ts", specifier: "~/lib/helpers", known, path })).toBe("app/lib/helpers.ts")
  }).pipe(Effect.provide(Path.layer)),
)

it.effect("a package specifier stays unresolved rather than guessed", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    expect(resolveSpecifier({ from: "src/a.ts", specifier: "@remix-run/node", known, path })).toBeUndefined()
    expect(resolveSpecifier({ from: "src/a.ts", specifier: "./missing", known, path })).toBeUndefined()
  }).pipe(Effect.provide(Path.layer)),
)

it.effect("the graph records importers by file and by name", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const files = [
      { path: "src/types.ts", text: "", units: [], importStatements: [], facts: empty },
      { path: "src/a.ts", text: "", units: [], importStatements: [{ specifier: "./types", names: ["Task"], typeOnly: false }], facts: empty },
      { path: "src/b.ts", text: "", units: [], importStatements: [{ specifier: "./types", names: [], typeOnly: false }], facts: empty },
    ]
    const graph = buildImportGraph(files, path)
    expect(graph.unresolved).toBe(0)
    expect(graph.importersOf.get("src/types.ts")?.length).toBe(2)
    expect(graph.importersOfName("src/types.ts", "Task").length).toBe(1)
    expect(graph.importersOfName("src/types.ts", "Task")[0]?.importer).toBe("src/a.ts")
  }).pipe(Effect.provide(Path.layer)),
)
