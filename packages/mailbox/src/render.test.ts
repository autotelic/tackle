import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { appendTurn } from "./append.ts"
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

describe("append", () => {
  it("refuses a turn whose path is already in the log", () => {
    const first = { turns: [turn(1)] }
    expect(() =>
      appendTurn(first, {
        at: 1_800_000_000_000,
        path: "0001-a-turn.md",
        body: "# 0001 — TAC-15 — again\n",
      }),
    ).toThrow(/already in the log/)
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

  it("refuses two turns at one path, because one would be unrenderable", () => {
    const body = "# 0001 — TAC-14 — a\n\nBody.\n"
    const text = [
      JSON.stringify({
        seq: 1,
        tid: turn(1).tid,
        sender: "TAC-14",
        replyTo: null,
        path: "0001-a.md",
        body,
      }),
      JSON.stringify({
        seq: 2,
        tid: turn(2).tid,
        sender: "TAC-15",
        replyTo: turn(1).tid,
        path: "0001-a.md",
        body,
      }),
    ].join("\n")
    expect(() => parseLog(text)).toThrow(/duplicate path/)
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

  it("refuses a repeated seq", () => {
    const lines = [turn(1), turn(1, { tid: "234567abcdefz", replyTo: null })].map((entry) =>
      JSON.stringify(entry),
    )
    expect(() => parseLog(lines.join("\n"))).toThrow(/seq must be dense/)
  })
})

describe("append", () => {
  const first = turn(1, { tid: "234567abcdef2" })
  const second = turn(2, { tid: "234567abcdef3", replyTo: first.tid })
  const log = { turns: [first, second] }

  it("assigns the next seq, a later TID, and the previous turn as the edge", () => {
    const appended = appendTurn(log, {
      path: "0003-c.md",
      body: "# 0003 — TAC-15 — c\n",
      at: 1_800_000_000_000,
    })
    expect(appended.turn.seq).toBe(3)
    expect(appended.turn.replyTo).toBe(second.tid)
    expect(appended.turn.tid > second.tid).toBe(true)
  })

  it("honours an explicit reply edge", () => {
    const appended = appendTurn(log, {
      path: "0003-c.md",
      body: "# 0003 — TAC-15 — c\n",
      replyTo: first.tid,
      at: 1_800_000_000_000,
    })
    expect(appended.turn.replyTo).toBe(first.tid)
  })

  it("refuses an edge that names no admitted turn", () => {
    expect(() =>
      appendTurn(log, {
        path: "0003-c.md",
        body: "# 0003 — TAC-15 — c\n",
        replyTo: "234567abcdef9",
        at: 1_800_000_000_000,
      }),
    ).toThrow(/replyTo names no earlier turn/)
  })

  it("refuses a filename whose prefix is not the next seq", () => {
    expect(() =>
      appendTurn(log, {
        at: 1_800_000_000_000,
        path: "0002-wrong.md",
        body: "# 0002 — TAC-15 — wrong\n",
      }),
    ).toThrow(/filename says 0002 but this turn is seq 3/)
  })

  it("takes the sender from the heading when none is passed", () => {
    const appended = appendTurn(log, {
      at: 1_800_000_000_000,
      path: "0003-c.md",
      body: "# 0003 — TAC-15 — c\n",
    })
    expect(appended.turn.sender).toBe("TAC-15")
  })
})

describe("log invariants", () => {
  it("refuses a gap in seq", () => {
    const lines = [turn(1), turn(3, { replyTo: turn(1).tid })].map((entry) => JSON.stringify(entry))
    expect(() => parseLog(lines.join("\n"))).toThrow(/seq must be dense/)
  })

  it("refuses a TID that sorts before its predecessor", () => {
    const lines = [
      turn(1, { tid: "234567abcdefg" }),
      turn(2, { tid: "234567abcdeee", replyTo: "234567abcdefg" }),
    ].map((entry) => JSON.stringify(entry))
    expect(() => parseLog(lines.join("\n"))).toThrow(/tid is not increasing/)
  })
})
