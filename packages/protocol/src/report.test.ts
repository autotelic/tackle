import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  countsOf,
  decodeDiagnostic,
  decodeEngineSummary,
  decodeReport,
  exitCodeFor,
  makeReport,
  parseJsonl,
  sortDiagnostics,
  toJsonl,
  type Diagnostic,
} from "./report.ts"

const at = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  engine: "test",
  ruleId: "test/rule",
  severity: "warn",
  message: "a finding",
  location: { file: "src/a.ts", line: 1, column: 1 },
  ...overrides,
})

describe("countsOf", () => {
  it("tallies each severity", () => {
    expect(countsOf([at(), at({ severity: "error" }), at({ severity: "info" })])).toEqual({
      error: 1,
      warn: 1,
      info: 1,
    })
  })
})

describe("sortDiagnostics", () => {
  it("orders worst-first, then by place", () => {
    const sorted = sortDiagnostics([
      at({ severity: "info", location: { file: "a.ts", line: 1, column: 1 } }),
      at({ severity: "error", location: { file: "b.ts", line: 9, column: 1 } }),
      at({ severity: "error", location: { file: "b.ts", line: 2, column: 1 } }),
    ])
    expect(sorted.map((d) => `${d.severity}:${d.location.line}`)).toEqual([
      "error:2",
      "error:9",
      "info:1",
    ])
  })
})

describe("exitCodeFor", () => {
  const report = makeReport({ diagnostics: [at()], files: 1, generators: [] })
  it("fails on errors", () => {
    const errored = makeReport({
      diagnostics: [at({ severity: "error" })],
      files: 1,
      generators: [],
    })
    expect(exitCodeFor({ report: errored })).toBe(1)
    expect(exitCodeFor({ report })).toBe(0)
  })
  it("fails on warnings past the ceiling", () => {
    expect(exitCodeFor({ report, maxWarnings: 0 })).toBe(1)
    expect(exitCodeFor({ report, maxWarnings: 5 })).toBe(0)
  })
})

describe("jsonl", () => {
  it("round-trips and skips blank lines", () => {
    const diagnostics = [at(), at({ severity: "error" })]
    expect(parseJsonl(toJsonl(diagnostics) + "\n\n")).toEqual(diagnostics)
  })
})

describe("decodeReport", () => {
  it("recomputes the aggregates instead of trusting the writer's tallies", () => {
    const lying = {
      lexicon: { name: "report", version: 1 },
      counts: { error: 9, warn: 9, info: 9 },
      files: 99,
      diagnostics: [at({ severity: "error" })],
      generators: [],
    }
    const decoded = decodeReport(lying)
    expect(decoded?.counts).toEqual({ error: 1, warn: 0, info: 0 })
    expect(decoded?.files).toBe(1)
  })

  it("degrades a malformed report to undefined, never a partial one", () => {
    expect(
      decodeReport({ lexicon: { name: "report", version: 1 }, diagnostics: "not an array" }),
    ).toBeUndefined()
  })
})

describe("countsOf (property)", () => {
  it("tallies every diagnostic exactly once", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("error", "warn", "info"), { maxLength: 40 }),
        (severities) => {
          const counts = countsOf(severities.map((severity) => at({ severity })))
          expect(counts.error + counts.warn + counts.info).toBe(severities.length)
        },
      ),
    )
  })
})

/*
 * The judged provenance, read as untrusted input: an engine's JSON is bytes, and a reader
 * that drops `move`/`score`/`repair` is how "judged" quietly becomes "determined". A
 * `repair` that is present but unreadable fails the record, because a half-read repair
 * lists fewer sites than the finding has.
 */
describe("judged provenance", () => {
  it("reads move, score, confidence, and a repair", () => {
    const decoded = decodeDiagnostic({
      ...at(),
      judged: true,
      move: "combine",
      score: 0.82,
      confidence: 0.91,
      repair: {
        operation: "move",
        keep: { file: "src/a.ts", line: 3, column: 1 },
        remove: [],
        cascade: [{ file: "src/a.ts", line: 3, column: 1, instruction: "drop the import" }],
        complete: true,
        settled: "the destination exists",
      },
    })
    expect(decoded?.move).toBe("combine")
    expect(decoded?.score).toBe(0.82)
    expect(decoded?.confidence).toBe(0.91)
    expect(decoded?.repair?.complete).toBe(true)
    expect(decoded?.repair?.cascade).toHaveLength(1)
  })

  it("refuses a repair that is present but not one", () => {
    expect(decodeDiagnostic({ ...at(), repair: { operation: "merge" } })).toBeUndefined()
  })

  it("refuses a move outside the closed set", () => {
    expect(decodeDiagnostic({ ...at(), move: "delete" })).toBeUndefined()
  })

  it("reads an engine's status and the candidates it did not judge", () => {
    const decoded = decodeEngineSummary({
      id: "joggle",
      diagnostics: 0,
      error: 0,
      warn: 0,
      info: 0,
      status: "replayed",
      unjudged: 3,
      drops: [
        { stage: "declined", count: 12 },
        { stage: "unreadable", count: 3 },
      ],
    })
    expect(decoded?.status).toBe("replayed")
    expect(decoded?.unjudged).toBe(3)
    expect(decoded?.drops).toEqual([
      { stage: "declined", count: 12 },
      { stage: "unreadable", count: 3 },
    ])
  })

  it("refuses an engine status outside the closed set", () => {
    expect(
      decodeEngineSummary({
        id: "joggle",
        diagnostics: 0,
        error: 0,
        warn: 0,
        info: 0,
        status: "idle",
      }),
    ).toBeUndefined()
  })
})
