import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { decodeBaseline } from "./baseline.ts"
import { compileLexicon, loadJson, makeAjv } from "./fixture-support.ts"
import { decodeReport, type Diagnostic, type Report, type Severity } from "./report.ts"

/*
 * The projections are SPECIFIED in `docs/projections.md` and implemented by a rendering
 * host — not here. This test is the outside judge for that spec: it re-derives each target
 * from the report fixture per the documented mapping and asserts the worked examples under
 * `fixtures/projections/` match. If the spec and the examples ever disagree, this is where
 * it shows.
 */

const source = decodeReport(loadJson("fixtures/projections/report.golden.json"))
if (source === undefined) throw new Error("fixtures/projections/report.golden.json did not decode")

const baseline = decodeBaseline(loadJson("fixtures/projections/baseline.golden.json"))
if (baseline === undefined) throw new Error("the projection baseline did not decode")
const accepted: ReadonlySet<string> = new Set(baseline.identities)

const nameOf = (diagnostic: Diagnostic): string => `${diagnostic.engine}/${diagnostic.ruleId}`
const identityOf = (diagnostic: Diagnostic): string =>
  diagnostic.identity ?? `${diagnostic.engine}/${diagnostic.ruleId}:${diagnostic.location.file}`
const severity01 = (severity: Severity): "error" | "warning" | "note" =>
  severity === "error" ? "error" : severity === "warn" ? "warning" : "note"
const severityNumeric = (severity: Severity): 1 | 2 | 3 =>
  severity === "error" ? 1 : severity === "warn" ? 2 : 3
const severityCodeClimate = (severity: Severity): "major" | "minor" | "info" =>
  severity === "error" ? "major" : severity === "warn" ? "minor" : "info"

const toSarif = (report: Report, known?: ReadonlySet<string>) => {
  const rules = new Map<string, unknown>()
  for (const diagnostic of report.diagnostics) {
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
            version: String(report.lexicon.version),
            informationUri: "https://github.com/autotelic/tackle",
            rules: [...rules.values()],
          },
        },
        results: report.diagnostics.map((diagnostic) => {
          const isKnown = known !== undefined && known.has(identityOf(diagnostic))
          const properties: Record<string, unknown> = {}
          if (diagnostic.fixable === true) properties.fixable = true
          if (known !== undefined) properties.baseline = isKnown ? "known" : "novel"
          return {
            ruleId: nameOf(diagnostic),
            level: severity01(diagnostic.severity),
            message: { text: diagnostic.message },
            ...(Object.keys(properties).length === 0 ? {} : { properties }),
            ...(isKnown
              ? {
                  suppressions: [
                    {
                      kind: "external",
                      status: "accepted",
                      justification: "accepted in the baseline",
                    },
                  ],
                }
              : {}),
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
          }
        }),
      },
    ],
  }
}

const toLsp = (report: Report): unknown =>
  report.diagnostics.map((diagnostic) => {
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
      ...(diagnostic.docsUrl === undefined
        ? {}
        : { codeDescription: { href: diagnostic.docsUrl } }),
    }
  })

const toCodeClimate = (report: Report): unknown =>
  report.diagnostics.map((diagnostic) => ({
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
    fingerprint: identityOf(diagnostic),
  }))

describe("report projections", () => {
  it("takes a report that satisfies the report schema", () => {
    const validate = compileLexicon(makeAjv(), "report")
    const ok = validate(loadJson("fixtures/projections/report.golden.json"))
    if (!ok) throw new Error(JSON.stringify(validate.errors))
    expect(ok).toBe(true)
  })

  it("maps to the documented SARIF 2.1.0 example", () => {
    expect(toSarif(source)).toEqual(loadJson("fixtures/projections/sarif.golden.json"))
  })

  it("annotates novel and known findings against the accepted baseline", () => {
    expect(toSarif(source, accepted)).toEqual(
      loadJson("fixtures/projections/sarif-with-baseline.golden.json"),
    )
  })

  it("maps to the documented LSP 3.17 example (1-based report to 0-based editor)", () => {
    expect(toLsp(source)).toEqual(loadJson("fixtures/projections/lsp.golden.json"))
  })

  it("maps to the documented Code Climate example (identity, never line)", () => {
    expect(toCodeClimate(source)).toEqual(loadJson("fixtures/projections/codeclimate.golden.json"))
  })
})

describe("severity mappings (property)", () => {
  it("maps every severity to exactly one target value", () => {
    fc.assert(
      fc.property(fc.constantFrom<Severity>("error", "warn", "info"), (severity) => {
        expect([1, 2, 3]).toContain(severityNumeric(severity))
        expect(["error", "warning", "note"]).toContain(severity01(severity))
        expect(["major", "minor", "info"]).toContain(severityCodeClimate(severity))
      }),
    )
  })
})
