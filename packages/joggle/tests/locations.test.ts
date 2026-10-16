import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadWorkspace } from "../src/workspace.ts"

test("a declaration after non-ASCII text is located on its own line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-locations-"))
  writeFileSync(
    join(dir, "a.ts"),
    "// ——————————————————————————————\n// ——————————————————————————————\n\n\nexport function second() { return 2 }\n",
  )
  const workspace = await Effect.runPromise(
    loadWorkspace(dir, ["."]).pipe(Effect.provide(NodeServices.layer)),
  )
  const second = workspace.units.find((unit) => unit.name === "second")
  // The parser counts UTF-16 code units; a line table in bytes put this on line 2.
  expect(second?.location.line).toBe(5)
  expect(second?.location.column).toBe("export ".length + 1)
})
