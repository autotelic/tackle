import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { discoverFiles, loadWorkspace } from "../src/workspace.ts"

const fixtures = "tests/fixtures/javascript"

const workspace = () =>
  Effect.runPromise(loadWorkspace(fixtures, ["."]).pipe(Effect.provide(NodeServices.layer)))

test("a `.js` file with JSX and a `.jsx` file both parse", async () => {
  const loaded = await workspace()
  const paths = loaded.files.map((file) => file.path).sort()
  // The `.js` one is the point: JSX in it is legal under the configs most React
  // apps use, and the first reading as plain JS is rejected by the parser.
  expect(paths).toContain("with-jsx.js")
  expect(paths).toContain("component.jsx")
  expect(paths).not.toContain("broken.js")
})

test("a declaration in JavaScript carries no type signal", async () => {
  const loaded = await workspace()
  const card = loaded.units.find((unit) => unit.name === "Card")
  expect(card).toBeDefined()
  // This is what makes a shape match in a JS codebase weaker evidence, and the
  // finding now says so rather than presenting it as typed evidence.
  expect(card?.typed).toBe(false)
  expect(card?.typeRefs).toEqual([])
})

test("a file the parser rejects is reported, not silently empty", async () => {
  const loaded = await workspace()
  // Before this, the parse result's `errors` array was never read: a file the
  // parser rejected looked exactly like a file with nothing in it, and every
  // rule's view of the repository had a hole nobody could see.
  expect(loaded.unparsed.length).toBe(1)
  expect(loaded.unparsed[0]?.path).toBe("broken.js")
  expect(loaded.unparsed[0]?.reason.length).toBeGreaterThan(0)
})

test("a .gitignore is honoured, including a nested one", async () => {
  const found = await Effect.runPromise(
    discoverFiles("tests/fixtures/gitignored", ["."], undefined).pipe(Effect.provide(NodeServices.layer)),
  )
  // `generated/` and `*.min.js` from the root, `local.ts` from the nested file.
  expect(found.files.map((file) => file.replace(/.*fixtures\/gitignored\//, ""))).toEqual([
    "src/keep.ts",
    "sub/keep.ts",
  ])
  expect(found.ignored).toBe(2)
  // The ignored directory is counted as a directory, because how many files it
  // hid is unknown by construction.
  expect(found.ignoredDirectories).toBe(1)
})

test("discovery reports what it did not parse", async () => {
  const found = await Effect.runPromise(
    discoverFiles(fixtures, ["."], undefined).pipe(Effect.provide(NodeServices.layer)),
  )
  // Three source files are discovered; one of them then fails to parse, which is
  // a different report. A non-source file is counted here instead.
  expect(found.files.length).toBe(3)
  expect(found.skippedExtensions).toEqual([{ extension: ".md", count: 1 }])
  expect(found.truncated).toBe(false)
})

test("the rejection and the files it rejected are counted together", async () => {
  const loaded = await workspace()
  expect(loaded.files.length + loaded.unparsed.length).toBe(3)
})
