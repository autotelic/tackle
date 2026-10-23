import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, FileSystem, Path } from "effect"
import { NodeServices } from "@effect/platform-node"
import { lexiconRef, type Menu } from "@autotelic/protocol"
import { describe, expect, it } from "vitest"
import { compareCatalog, compareJson, compareMenu, compareText } from "./check.ts"

/*
 * The staleness gate had no tests, which is how it could grow a hole: every comparison
 * here fails CLOSED on a missing or malformed file, because `plumb-ui` fails OPEN on the
 * same input. A file the gate cannot read is stale, never "fine because unreadable".
 */

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)))

const withFile = async (
  text: string | undefined,
  use: (file: string) => Promise<void>,
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "cutlist-check-"))
  const file = join(root, "artifact")
  if (text !== undefined) writeFileSync(file, text)
  try {
    await use(file)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const menu: Menu = {
  lexicon: lexiconRef("menu"),
  title: "Menu",
  hash: "abc123",
  entries: [],
  orphans: [],
  duplicates: [],
}

describe("compareText", () => {
  it("is stale when the file is missing", async () => {
    await withFile(undefined, async (file) => {
      const result = await run(compareText({ file, fresh: "x" }))
      expect(result.stale).toBe(true)
      expect(result.committed).toBeUndefined()
    })
  })

  it("is clean only on identical bytes", async () => {
    await withFile("abc\n", async (file) => {
      expect((await run(compareText({ file, fresh: "abc\n" }))).stale).toBe(false)
      expect((await run(compareText({ file, fresh: "abc" }))).stale).toBe(true)
    })
  })
})

describe("compareJson", () => {
  it("compares the model, so formatting cannot fail the gate", async () => {
    await withFile('{"a":[1,2],"b":true}', async (file) => {
      const fresh = { a: [1, 2], b: true }
      expect((await run(compareJson({ file, fresh }))).stale).toBe(false)
    })
  })

  it("is stale when the model differs or the file is malformed", async () => {
    await withFile('{"a":1}', async (file) => {
      expect((await run(compareJson({ file, fresh: { a: 2 } }))).stale).toBe(true)
    })
    await withFile("{not json", async (file) => {
      expect((await run(compareJson({ file, fresh: { a: 1 } }))).stale).toBe(true)
    })
  })
})

describe("compareCatalog", () => {
  it("matches on the catalog's own hash, not its bytes", async () => {
    await withFile('{\n  "hash": "abc123",\n  "components": []\n}\n', async (file) => {
      expect((await run(compareCatalog({ file, hash: "abc123" }))).stale).toBe(false)
      expect((await run(compareCatalog({ file, hash: "other" }))).stale).toBe(true)
    })
  })

  it("is stale when the file is missing, malformed, or carries no hash", async () => {
    await withFile(undefined, async (file) => {
      expect((await run(compareCatalog({ file, hash: "abc123" }))).stale).toBe(true)
    })
    await withFile("{not json", async (file) => {
      expect((await run(compareCatalog({ file, hash: "abc123" }))).stale).toBe(true)
    })
    await withFile('{"components":[]}', async (file) => {
      expect((await run(compareCatalog({ file, hash: "abc123" }))).stale).toBe(true)
    })
  })
})

describe("compareMenu", () => {
  it("compares the decoded menu, so a reformatted menu is clean", async () => {
    const reformatted = JSON.stringify(menu, null, 4)
    await withFile(reformatted, async (file) => {
      expect((await run(compareMenu({ file, fresh: menu }))).stale).toBe(false)
    })
  })

  it("is stale when the menu's content moved", async () => {
    await withFile(JSON.stringify(menu), async (file) => {
      const changed = { ...menu, hash: "def456" }
      expect((await run(compareMenu({ file, fresh: changed }))).stale).toBe(true)
    })
  })
})
