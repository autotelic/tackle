import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Service as Tsgo, layer as tsgoLayer } from "../src/tsgo.ts"

const binary = resolve("node_modules/.bin/tsgo")

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
