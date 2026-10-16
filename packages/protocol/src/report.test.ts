import { describe, expect, it } from "vitest"
import {
  countsOf,
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
    expect(exitCodeFor(errored)).toBe(1)
    expect(exitCodeFor(report)).toBe(0)
  })
  it("fails on warnings past the ceiling", () => {
    expect(exitCodeFor(report, 0)).toBe(1)
    expect(exitCodeFor(report, 5)).toBe(0)
  })
})

describe("jsonl", () => {
  it("round-trips and skips blank lines", () => {
    const diagnostics = [at(), at({ severity: "error" })]
    expect(parseJsonl(toJsonl(diagnostics) + "\n\n")).toEqual(diagnostics)
  })
})
