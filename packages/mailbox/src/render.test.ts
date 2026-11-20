import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { exportDirectory } from "./export.ts"
import { parseLog, serializeLog, type Turn } from "./log.ts"
import { renderLog, verifyLog } from "./render.ts"
import { isTid } from "./tid.ts"

const thread = fileURLToPath(new URL("../../../docs/threads/at-seam", import.meta.url))

const filesIn = async (dir: string): Promise<ReadonlyMap<string, string>> => {
  const files = new Map<string, string>()
  for (const name of (await readdir(dir)).sort()) {
    if (name.endsWith(".md")) files.set(name, await readFile(join(dir, name), "utf8"))
  }
  return files
}

const turn = (seq: number, overrides: Partial<Turn> = {}): Turn => ({
  seq,
  tid: `234567abcdef${"abcdefghij"[seq % 10]}`,
  sender: "TAC-14",
  replyTo: null,
  path: `000${seq}-a-turn.md`,
  body: `# 000${seq} — TAC-14 — a turn\n\nBody.\n`,
  ...overrides,
})

describe("the thread's own projection", () => {
  it("renders the log back to the committed turn files", async () => {
    const log = await exportDirectory(thread, { at: "2026-11-20T16:03:00.000Z" })
    expect(log.turns.length).toBeGreaterThanOrEqual(10)
    expect(verifyLog(log, await filesIn(thread))).toEqual([])
  })

  it("links every turn to its predecessor and names it with a TID", async () => {
    const log = await exportDirectory(thread, { at: "2026-11-20T16:03:00.000Z" })
    for (const [index, entry] of log.turns.entries()) {
      expect(isTid(entry.tid)).toBe(true)
      expect(entry.replyTo).toBe(index === 0 ? null : log.turns[index - 1]!.tid)
      expect(entry.seq).toBe(index + 1)
    }
  })

  it("survives serialize and parse without changing bytes", async () => {
    const log = await exportDirectory(thread, { at: "2026-11-20T16:03:00.000Z" })
    const reopened = parseLog(serializeLog(log))
    expect(serializeLog(reopened)).toBe(serializeLog(log))
    expect(verifyLog(reopened, await filesIn(thread))).toEqual([])
  })
})

describe("drift", () => {
  const files = new Map([
    ["0001-a.md", "# 0001 — TAC-14 — a\n"],
    ["0002-b.md", "# 0002 — TAC-15 — b\n"],
  ])

  it("names an edited turn", () => {
    const log = { turns: [turn(1, { path: "0001-a.md", body: files.get("0001-a.md")! })] }
    const drifted = new Map([["0001-a.md", "# 0001 — TAC-14 — edited\n"]])
    expect(verifyLog(log, drifted)).toEqual([{ path: "0001-a.md", kind: "differs" }])
  })

  it("names a turn the log never admitted", () => {
    const log = { turns: [turn(1, { path: "0001-a.md", body: files.get("0001-a.md")! })] }
    expect(verifyLog(log, files)).toContainEqual({ path: "0002-b.md", kind: "extra" })
  })

  it("names a turn the repository lost", () => {
    const log = {
      turns: [
        turn(1, { path: "0001-a.md", body: files.get("0001-a.md")! }),
        turn(2, { path: "0002-b.md", body: files.get("0002-b.md")! }),
      ],
    }
    const lost = new Map(files)
    lost.delete("0002-b.md")
    expect(verifyLog(log, lost)).toContainEqual({ path: "0002-b.md", kind: "missing" })
  })

  it("ignores files that are not turns", () => {
    const log = { turns: [turn(1, { path: "0001-a.md", body: files.get("0001-a.md")! })] }
    const withReadme = new Map(files)
      .set("README.md", "# thread\n")
      .set("decisions.md", "# decisions\n")
    expect(verifyLog(log, withReadme)).not.toContainEqual({ path: "README.md", kind: "extra" })
  })
})

describe("log decoding", () => {
  it("refuses a reply edge that names no earlier turn", () => {
    const lines = [turn(1), turn(2, { replyTo: "234567abcdefz" })].map((entry) =>
      JSON.stringify(entry),
    )
    expect(() => parseLog(lines.join("\n"))).toThrow(/replyTo names no earlier turn/)
  })

  it("refuses a duplicate TID", () => {
    const lines = [turn(1), turn(2, { tid: turn(1).tid, replyTo: null })].map((entry) =>
      JSON.stringify(entry),
    )
    expect(() => parseLog(lines.join("\n"))).toThrow(/duplicate tid/)
  })

  it("refuses a seq that goes backwards", () => {
    const lines = [turn(2), turn(1, { replyTo: null })].map((entry) => JSON.stringify(entry))
    expect(() => parseLog(lines.join("\n"))).toThrow(/seq is not increasing/)
  })
})
