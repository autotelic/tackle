import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emptyTypeIndex, indexOf, loadTypeFacts, parseTrace } from "../src/typetrace.ts"
import { tsgoStub } from "./support.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

const root = "/Users/dev/project"

/** One trace descriptor, with the fields the reader actually reads. */
const descriptor = (input: {
  id: number
  display?: string
  symbolName?: string
  flags?: ReadonlyArray<string>
  typeArguments?: ReadonlyArray<number>
  unionTypes?: ReadonlyArray<number>
  path?: string
  line?: number
}) => ({
  id: input.id,
  ...(input.display === undefined ? {} : { display: input.display }),
  ...(input.symbolName === undefined ? {} : { symbolName: input.symbolName }),
  flags: input.flags ?? ["Object"],
  ...(input.typeArguments === undefined ? {} : { typeArguments: input.typeArguments }),
  ...(input.unionTypes === undefined ? {} : { unionTypes: input.unionTypes }),
  ...(input.path === undefined || input.line === undefined
    ? {}
    : { firstDeclaration: { path: input.path, start: { line: input.line, character: 1 } } }),
})

test("a declaration joins to the type the checker resolved for it", () => {
  const index = indexOf(
    parseTrace(root, [
      [
        descriptor({ id: 1, display: "{ id: String }", symbolName: "User", path: root + "/src/a.ts", line: 10 }),
      ],
    ]),
  )
  expect(index.at("src/a.ts", 10, "User")?.display).toBe("{ id: String }")
  expect(index.at("src/a.ts", 10, "User")?.origin).toEqual({ file: "src/a.ts", line: 10 })
})

test("a declaration pair joins by name when the type sits on the other one", () => {
  // `const Severity = Schema.Literals(...)` carries the type; `type Severity =`
  // carries joggle's unit. The name is what ties them.
  const index = indexOf(
    parseTrace(root, [
      [descriptor({ id: 1, display: "\"error\" | \"warn\"", symbolName: "Severity", path: root + "/src/schema.ts", line: 5 })],
    ]),
  )
  expect(index.at("src/schema.ts", 9, "Severity")?.display).toBe("\"error\" | \"warn\"")
  // With no name there is nothing to fall back to.
  expect(index.at("src/schema.ts", 9)).toBeUndefined()
})

test("the longest printed type wins when two checkers disagree", () => {
  const index = indexOf(
    parseTrace(root, [
      [descriptor({ id: 1, display: "{ a: String }", symbolName: "X", path: root + "/src/a.ts", line: 1 })],
      [descriptor({ id: 1, display: "{ a: String; b: Number }", symbolName: "X", path: root + "/src/a.ts", line: 1 })],
    ]),
  )
  expect(index.at("src/a.ts", 1, "X")?.display).toBe("{ a: String; b: Number }")
})

test("type arguments and union members resolve to their printed forms", () => {
  const index = indexOf(
    parseTrace(root, [
      [
        descriptor({ id: 1, display: "Effect<A, E, R>", symbolName: "Effect", typeArguments: [2, 3, 4], path: root + "/src/a.ts", line: 2 }),
        descriptor({ id: 2, display: "A" }),
        descriptor({ id: 3, display: "E" }),
        descriptor({ id: 4, display: "R" }),
        descriptor({ id: 5, display: "\"on\" | \"off\"", symbolName: "Flag", unionTypes: [6, 7], path: root + "/src/b.ts", line: 3 }),
        descriptor({ id: 6, display: "\"on\"" }),
        descriptor({ id: 7, display: "\"off\"" }),
      ],
    ]),
  )
  expect(index.at("src/a.ts", 2, "Effect")?.arguments).toEqual(["A", "E", "R"])
  expect(index.at("src/b.ts", 3, "Flag")?.members).toEqual(["\"on\"", "\"off\""])
})

test("a path outside the root is not indexed", () => {
  const index = indexOf(
    parseTrace(root, [
      [descriptor({ id: 1, display: "T", symbolName: "T", path: "/elsewhere/src/a.ts", line: 1 })],
    ]),
  )
  expect(index.sites).toBe(0)
})

test("the trace path is matched without regard to case", () => {
  // macOS writes the path lowercased; the workspace keeps the case on disk.
  const index = indexOf(
    parseTrace(root, [
      [descriptor({ id: 1, display: "T", symbolName: "T", path: "/users/dev/project/src/a.ts", line: 1 })],
    ]),
  )
  expect(index.at("src/a.ts", 1, "T")?.display).toBe("T")
})

test("no trace is an empty index, not a failure", () => {
  expect(emptyTypeIndex.at("src/a.ts", 1, "T")).toBeUndefined()
  expect(emptyTypeIndex.sites).toBe(0)
})

test("a cached index is reused without generating a trace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-types-"))
  writeFileSync(
    join(dir, "types.json"),
    JSON.stringify({
      version: "1",
      tool: "tool-one",
      manifest: "manifest-one",
      entries: [
        {
          file: "src/a.ts",
          line: 4,
          name: "User",
          fact: {
            display: "{ id: String }",
            symbol: "User",
            flags: ["Object"],
            arguments: [],
            members: [],
            origin: { file: "src/a.ts", line: 4 },
          },
        },
      ],
    }),
  )
  const loaded = await Effect.runPromise(
    loadTypeFacts({ root, cacheDir: dir, tool: "tool-one", manifest: "manifest-one" }).pipe(
      Effect.provide(tsgoStub),
      Effect.provide(NodeServices.layer),
    ) as Effect.Effect<unknown, never, never>,
  )
  const result = loaded as { loadedFrom: string; index: { at: (f: string, l: number, n?: string) => { display: string } | undefined } }
  expect(result.loadedFrom).toBe("cache")
  expect(result.index.at("src/a.ts", 4, "User")?.display).toBe("{ id: String }")
})

test("a cache from a different manifest is not a hit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-types-"))
  writeFileSync(
    join(dir, "types.json"),
    JSON.stringify({ version: "1", tool: "tool-one", manifest: "old", entries: [] }),
  )
  // The stub's generateTrace writes nothing, so the trace yields no entries and
  // the load falls through to a fresh (empty) trace rather than the stale cache.
  const loaded = await Effect.runPromise(
    loadTypeFacts({ root, cacheDir: dir, tool: "tool-one", manifest: "new" }).pipe(
      Effect.provide(tsgoStub),
      Effect.provide(NodeServices.layer),
    ) as Effect.Effect<unknown, never, never>,
  )
  const result = loaded as { loadedFrom: string; index: { sites: number } }
  expect(result.loadedFrom).toBe("trace")
  expect(result.index.sites).toBe(0)
})
