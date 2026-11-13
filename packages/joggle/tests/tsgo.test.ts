import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Service as Tsgo, compilerArgs, layer as tsgoLayer } from "../src/tsgo.ts"

const binary = resolve("node_modules/.bin/tsc")

test("the compiler's view keeps every source file it lists, JavaScript included", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "joggle-tsgo-")))
  mkdirSync(join(dir, "src"))
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { allowJs: true, noEmit: true, module: "nodenext", jsx: "preserve" },
      include: ["src"],
    }),
  )
  const sources = ["a.ts", "b.tsx", "c.mts", "d.cts", "e.js", "f.jsx", "g.mjs", "h.cjs"]
  for (const file of sources) writeFileSync(join(dir, "src", file), "export const x = 1\n")
  writeFileSync(join(dir, "src", "env.d.ts"), "declare const y: number\n")

  const files = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Tsgo).listFiles(dir)
    }).pipe(
      Effect.provide(tsgoLayer(binary)),
      Effect.provide(NodeServices.layer),
    ),
  )

  // Before, only `.ts` and `.tsx` survived, so a run with no paths analysed none
  // of a project's JavaScript and said nothing about it.
  expect(files).toEqual(sources.map((file) => join(dir, "src", file)))
})

test("a root reached through a symlink still lists its files", async () => {
  // tsgo prints the path it RESOLVED: given a cwd under /tmp, it lists /private/tmp.
  // Comparing those lexically rejected every file, so a checkout under a symlinked
  // path measured nothing and said so as if the tree were empty.
  const real = realpathSync(mkdtempSync(join(tmpdir(), "joggle-tsgo-real-")))
  const linked = real + "-link"
  mkdirSync(join(real, "src"))
  writeFileSync(
    join(real, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { noEmit: true, module: "nodenext" },
      include: ["src"],
    }),
  )
  writeFileSync(join(real, "src", "a.ts"), "export const x = 1\n")
  symlinkSync(real, linked)
  try {
    const files = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Tsgo).listFiles(linked)
      }).pipe(Effect.provide(tsgoLayer(binary)), Effect.provide(NodeServices.layer)),
    )
    expect(files).toEqual([join(linked, "src", "a.ts")])
  } finally {
    rmSync(linked, { force: true })
    rmSync(real, { recursive: true, force: true })
  }
})

test("the content-mapper opt-in is a flag in front, and nothing without it", () => {
  expect(compilerArgs(["--noEmit"], false)).toEqual(["--noEmit"])
  expect(compilerArgs(["--noEmit"], true)).toEqual(["--runExternalCode", "--noEmit"])
})
