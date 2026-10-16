import { expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { typesAtPositions } from "../src/typefacts.ts"

/**
 * The fact layer for item 4: the checker's type at a byte offset. The join is by
 * offset, which both the checker and oxc read from the same file.
 */
it(
  "the checker answers a type at an offset",
  async () => {
    const file = "tests/fixtures/node-types/src/sample.ts"
    const text = readFileSync(file, "utf8")
    const position = text.indexOf("a + b")
    const found = await typesAtPositions({
      cwd: process.cwd(),
      tsconfig: "tests/fixtures/node-types/tsconfig.json",
      requests: [{ file, position }],
    })
    expect(found.found.length).toBe(1)
    expect(found.found[0]?.type).toBe("number")
  },
  120000,
)
