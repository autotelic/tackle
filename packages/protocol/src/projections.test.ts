import { describe, expect, it } from "vitest"
import { loadJson } from "./fixture-support.ts"
import { decodeReport, type Diagnostic, type Report, type Severity } from "./report.ts"

/*
 * The projections are SPECIFIED in `docs/projections.md` and implemented by a rendering
 * host — not here. This test is the outside judge for that spec: it re-derives each target
 * from the report fixture per the documented mapping and asserts the worked examples under
 * `fixtures/projections/` match. If the spec and the examples ever disagree, this is where
 * it shows.
 */

const report = decodeReport(loadJson("fixtures/report/golden.json"))
if (report === undefined) throw new Error("fixtures/report/golden.json did not decode")

const nameOf = (diagnostic: Diagnostic): string => `${diagnostic.engine}/${diagnostic.ruleId}`
const severity01 = (severity: Severity): "error" | "warning" | "note" =>
  severity === "error" ? "error" : severity === "warn" ? "warning" : "note"
const severityNumeric = (severity: Severity): 1 | 2 | 3 =>
  severity === "error" ? 1 : severity === "warn" ? 2 : 3
const severityCodeClimate = (severity: Severity): "major" | "minor" | "info" =>
  severity === "error" ? "major" : severity === "warn" ? "minor" : "info"

const toSarif = (source: Report): unknown => {
  const rules = new Map<string, unknown>()
  for (const diagnostic of source.diagnostics) {
    if (rules.has(nameOf(diagnostic))) continue
    rules.set(nameOf(diagnostic), {
      id: nameOf(diagnostic),
      name: nameOf(diagnostic),
      shortDescription: { text: diagnostic.message },
      ...(diagnostic.help === undefined ? {} : { help: { text: diagnostic.help } }),
      ...(diagnostic.docsUrl === undefined ? {} : { helpUri: diagnostic.docsUrl }),
    })
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "tackle",
            informationUri: "https://github.com/autotelic/tackle",
            rules: [...rules.values()],
          },
        },
        results: source.diagnostics.map((diagnostic) => ({
          ruleId: nameOf(diagnostic),
          level: severity01(diagnostic.severity),
          message: { text: diagnostic.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: diagnostic.location.file },
                region: {
                  startLine: diagnostic.location.line,
                  startColumn: diagnostic.location.column,
                  ...(diagnostic.location.endLine === undefined
                    ? {}
                    : { endLine: diagnostic.location.endLine }),
                  ...(diagnostic.location.endColumn === undefined
                    ? {}
                    : { endColumn: diagnostic.location.endColumn }),
                },
              },
            },
          ],
        })),
      },
    ],
  }
}

const toLsp = (source: Report): unknown =>
  source.diagnostics.map((diagnostic) => {
    const { line, column, endLine, endColumn } = diagnostic.location
    return {
      range: {
        start: { line: line - 1, character: column - 1 },
        end: { line: (endLine ?? line) - 1, character: (endColumn ?? column) - 1 },
      },
      severity: severityNumeric(diagnostic.severity),
      code: nameOf(diagnostic),
      source: diagnostic.engine,
      message: diagnostic.message,
    }
  })

const toCodeClimate = (source: Report): unknown =>
  source.diagnostics.map((diagnostic) => ({
    type: "issue",
    check_name: nameOf(diagnostic),
    description: diagnostic.message,
    categories: ["Style"],
    location: {
      path: diagnostic.location.file,
      lines: {
        begin: diagnostic.location.line,
        ...(diagnostic.location.endLine === undefined ? {} : { end: diagnostic.location.endLine }),
      },
    },
    severity: severityCodeClimate(diagnostic.severity),
    fingerprint:
      diagnostic.identity ??
      `${diagnostic.engine}/${diagnostic.ruleId}:${diagnostic.location.file}`,
  }))

describe("report projections", () => {
  it("maps to the documented SARIF 2.1.0 example", () => {
    expect(toSarif(report)).toEqual(loadJson("fixtures/projections/sarif.golden.json"))
  })

  it("maps to the documented LSP 3.17 example (1-based report to 0-based editor)", () => {
    expect(toLsp(report)).toEqual(loadJson("fixtures/projections/lsp.golden.json"))
  })

  it("maps to the documented Code Climate example (identity, never line)", () => {
    expect(toCodeClimate(report)).toEqual(loadJson("fixtures/projections/codeclimate.golden.json"))
  })
})
