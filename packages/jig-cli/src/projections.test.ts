import fc from "fast-check"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  decodeBaseline,
  decodeReport,
  makeReport,
  type Diagnostic,
  type Report,
} from "@autotelic/protocol"
import { parseEngineOutput } from "./engines.ts"
import {
  projectCodeClimate,
  projectLsp,
  projectSarif,
  renderCodeClimate,
  renderJsonl,
  renderLsp,
  renderSarif,
  severity01,
  severityCodeClimate,
  severityNumeric,
} from "./projections.ts"

/*
 * The outside judge for the projections.
 *
 * `protocol` SPECIFIES the mapping and freezes worked examples in its own fixtures; this
 * test reads those bytes — the same files `protocol`'s `projections.test.ts` derives — so
 * jig's implementation and the spec cannot drift without the fixtures going red. The path
 * crosses packages on purpose: the spec's fixtures live with the spec.
 */

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../protocol/fixtures/projections/${name}`, import.meta.url)),
      "utf8",
    ),
  ) as unknown

const report = decodeReport(fixture("report.golden.json"))
if (report === undefined) throw new Error("the projection report fixture did not decode")

const baseline = decodeBaseline(fixture("baseline.golden.json"))
if (baseline === undefined) throw new Error("the projection baseline fixture did not decode")
const accepted: ReadonlySet<string> = new Set(baseline.identities)

const at = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  engine: "test",
  ruleId: "test/rule",
  severity: "warn",
  message: "a finding",
  location: { file: "src/a.ts", line: 1, column: 1 },
  ...overrides,
})

describe("the projections match the spec's worked examples", () => {
  /*
   * Compare parsed values, not bytes: the goldens are `oxfmt`-canonical, so their
   * formatting (collapsed short arrays and objects) is the formatter's business, not
   * the projection's. The spec fixes the *shape and values*; that is what must hold.
   */
  it("renders SARIF 2.1.0", () => {
    expect(JSON.parse(renderSarif(report))).toEqual(fixture("sarif.golden.json"))
  })

  it("annotates novel and known findings against the accepted baseline", () => {
    expect(JSON.parse(renderSarif(report, accepted))).toEqual(
      fixture("sarif-with-baseline.golden.json"),
    )
  })

  it("renders LSP 3.17 diagnostics", () => {
    expect(JSON.parse(renderLsp(report))).toEqual(fixture("lsp.golden.json"))
  })

  it("renders Code Climate issues", () => {
    expect(JSON.parse(renderCodeClimate(report))).toEqual(fixture("codeclimate.golden.json"))
  })
})

describe("the SARIF read/write loop closes", () => {
  it("reads back the message, severity, and place of every result", () => {
    const single = makeReport({
      diagnostics: [
        at({ severity: "error", message: "one", location: { file: "a.ts", line: 4, column: 2 } }),
        at({ severity: "info", message: "two", location: { file: "b.ts", line: 9, column: 1 } }),
      ],
      files: 2,
      generators: [],
    })
    const reread = parseEngineOutput(renderSarif(single), { engine: "test", root: "/root" })
    expect(reread?.map((diagnostic) => [diagnostic.severity, diagnostic.message])).toEqual([
      ["error", "one"],
      ["info", "two"],
    ])
    expect(reread?.map((diagnostic) => diagnostic.location.file)).toEqual(["a.ts", "b.ts"])
  })
})

describe("the judged provenance survives the outward projection", () => {
  it("carries judged, move, and score in SARIF properties", () => {
    const judged = makeReport({
      diagnostics: [at({ judged: true, move: "combine", score: 0.82 })],
      files: 1,
      generators: [],
    })
    const sarif = JSON.stringify(projectSarif(judged))
    expect(sarif).toContain('"judged":true')
    expect(sarif).toContain('"move":"combine"')
    expect(sarif).toContain('"score":0.82')
  })
})

describe("LSP is 0-based and the Code Climate fingerprint is not a line (property)", () => {
  it("shifts every coordinate by exactly one, and defaults the end to the start", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
        fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
        (line, column, endLine, endColumn) => {
          const [lsp] = projectLsp(
            makeReport({
              diagnostics: [
                at({
                  location: {
                    file: "a.ts",
                    line,
                    column,
                    ...(endLine === undefined ? {} : { endLine }),
                    ...(endColumn === undefined ? {} : { endColumn }),
                  },
                }),
              ],
              files: 1,
              generators: [],
            }),
          )
          const range = lsp?.range as {
            readonly start: { readonly line: number; readonly character: number }
            readonly end: { readonly line: number; readonly character: number }
          }
          expect(range.start).toEqual({ line: line - 1, character: column - 1 })
          expect(range.end).toEqual({
            line: (endLine ?? line) - 1,
            character: (endColumn ?? column) - 1,
          })
        },
      ),
    )
  })

  it("derives the fingerprint from identity, so a moved line is not a new finding", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (line) => {
        const fingerprint = (location: { readonly line: number }): unknown =>
          projectCodeClimate(
            makeReport({
              diagnostics: [
                at({ identity: "stable", location: { file: "a.ts", ...location, column: 1 } }),
              ],
              files: 1,
              generators: [],
            }),
          )[0]?.fingerprint
        expect(fingerprint({ line })).toBe("stable")
      }),
    )
  })

  it("falls back to engine/rule/file when the finding declared no identity", () => {
    const [issue] = projectCodeClimate(
      makeReport({
        diagnostics: [at({ location: { file: "src/a.ts", line: 7, column: 3 } })],
        files: 1,
        generators: [],
      }),
    )
    expect(issue?.fingerprint).toBe("test/test/rule:src/a.ts")
  })
})

describe("severity mappings are total (property)", () => {
  it("maps every severity to exactly one target value", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Report["diagnostics"][number]["severity"]>("error", "warn", "info"),
        (severity) => {
          expect([1, 2, 3]).toContain(severityNumeric(severity))
          expect(["error", "warning", "note"]).toContain(severity01(severity))
          expect(["major", "minor", "info"]).toContain(severityCodeClimate(severity))
        },
      ),
    )
  })
})

describe("JSONL", () => {
  it("writes one finding per line, and nothing extra for none", () => {
    const jsonl = renderJsonl(report)
    expect(jsonl.trim().split("\n")).toHaveLength(report.diagnostics.length)
    expect(renderJsonl(makeReport({ diagnostics: [], files: 0, generators: [] }))).toBe("\n")
  })
})
