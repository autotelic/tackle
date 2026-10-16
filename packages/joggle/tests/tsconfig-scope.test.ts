import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tsconfigScope } from "../src/tsconfig-scope.ts"

const scopeOf = (tsconfig: string | undefined) => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-scope-"))
  if (tsconfig !== undefined) writeFileSync(join(dir, "tsconfig.json"), tsconfig)
  return Effect.runPromise(tsconfigScope(dir).pipe(Effect.provide(NodeServices.layer)))
}

test("a directory in include covers everything under it", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src"] }))
  expect(inScope("src/pages/index.astro")).toBe(true)
  expect(inScope("tests/a.astro")).toBe(false)
})

test("a glob in include matches at any depth", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src/**/*"] }))
  expect(inScope("src/a.astro")).toBe(true)
  expect(inScope("src/pages/a.astro")).toBe(true)
})

test("exclude wins over include", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src", "tests"], exclude: ["tests/fixtures"] }))
  expect(inScope("tests/a.astro")).toBe(true)
  expect(inScope("tests/fixtures/astro/src/Card.astro")).toBe(false)
})

test("no tsconfig, or one that is not plain JSON, scopes nothing out", async () => {
  expect((await scopeOf(undefined))("anything/a.astro")).toBe(true)
  expect((await scopeOf("{ // a comment\n }"))("anything/a.astro")).toBe(true)
})
