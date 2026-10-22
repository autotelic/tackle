import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contentMappersOf } from "../src/content-mappers.ts"
import { looksLikeSource } from "../src/source.ts"

const project = (files: Readonly<Record<string, unknown>>): string => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-mappers-"))
  mkdirSync(join(dir, "src"))
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body))
  }
  return dir
}

test("a mapper declared in a base config is found through extends", async () => {
  const dir = project({
    "tsconfig.base.json": {
      contentMappers: [{ package: "vue-content-mapper", extensions: [".vue"] }],
    },
    "tsconfig.json": {
      extends: "./tsconfig.base",
      contentMappers: [{ package: "svelte-content-mapper", extensions: [".svelte"] }],
    },
  })
  const mappers = await Effect.runPromise(
    contentMappersOf(dir).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(mappers).toEqual([
    { package: "svelte-content-mapper", extensions: [".svelte"] },
    { package: "vue-content-mapper", extensions: [".vue"] },
  ])
})

test("a leaf entry wins for the extension it re-registers", async () => {
  const dir = project({
    "tsconfig.base.json": {
      contentMappers: [{ package: "old-vue", extensions: [".vue"] }],
    },
    "tsconfig.json": {
      extends: "./tsconfig.base.json",
      contentMappers: [{ package: "new-vue", extensions: [".vue"] }],
    },
  })
  const mappers = await Effect.runPromise(
    contentMappersOf(dir).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(mappers).toEqual([{ package: "new-vue", extensions: [".vue"] }])
})

test("a commented tsconfig is read, not treated as declaring nothing", async () => {
  const dir = project({
    "tsconfig.json": `{
      // the mapper lives beside the config
      "contentMappers": [{ "package": "vue-content-mapper", "extensions": [".vue"], },],
    }`,
  })
  const mappers = await Effect.runPromise(
    contentMappersOf(dir).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(mappers).toEqual([{ package: "vue-content-mapper", extensions: [".vue"] }])
})

test("a config without mappers, or with no tsconfig, declares none", async () => {
  const empty = project({ "tsconfig.json": { include: ["src"] } })
  const absent = project({})
  const read = (dir: string) =>
    Effect.runPromise(contentMappersOf(dir).pipe(Effect.provide(NodeServices.layer)))
  expect(await read(empty)).toEqual([])
  expect(await read(absent)).toEqual([])
})

test("content-mapper declaration output is not source", () => {
  expect(looksLikeSource("src/App.d.svelte.ts")).toBe(false)
  expect(looksLikeSource("src/Page.d.vue.ts")).toBe(false)
  expect(looksLikeSource("src/App.svelte.0.d.ts")).toBe(false)
  expect(looksLikeSource("src/App.svelte")).toBe(false)
  expect(looksLikeSource("src/App.ts")).toBe(true)
  expect(looksLikeSource("src/App.astro")).toBe(true)
})
