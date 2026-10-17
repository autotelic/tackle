import { Match } from "effect"
import {
  identityOf,
  ruleNameOf,
  toJsonl,
  type Move,
  type Report,
  type Severity,
} from "@autotelic/protocol"

/*
 * The outward projections.
 *
 * `protocol/docs/projections.md` SPECIFIES these; a rendering host implements them, and
 * that host is `jig` — so a finding leaves the workspace without a second finding shape
 * being invented. The report is the truth; a projection drops, never bends.
 *
 * They are checked against `protocol`'s worked examples
 * (`fixtures/projections/*.golden.json`) in `projections.test.ts`. That is the outside
 * judge: if this file and the spec drift, the fixtures go red, not a reader's eyes.
 *
 * The external shapes are named types, not open dictionaries: a projection's whole job is
 * to produce one exact target contract, so `Record<string, unknown>` would discard the very
 * evidence the projection exists to pin down.
 */

/** The published SARIF 2.1.0 schema the worked example names. */
const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"

/** How the host names itself in a projection's driver metadata. */
const DRIVER_NAME = "tackle"
const INFORMATION_URI = "https://github.com/autotelic/tackle"

/*
 * The severity vocabularies, mapped once. Each is total over the protocol's three, which
 * is what makes the mapping a projection and not a policy: no target value is invented,
 * and none is dropped. `Match` is how `joggle` maps the same three, so the two hosts read
 * alike.
 */

/*
 * Each mapping is a `Match` over the three, exactly as `joggle` maps them. `Match.type` over
 * the whole union keeps the compiler checking coverage: add a fourth severity and every
 * `exhaustive` here stops compiling, rather than silently falling through a `default`.
 */
const level01 = Match.type<Severity>().pipe(
  Match.when("error", (): "error" | "warning" | "note" => "error"),
  Match.when("warn", (): "error" | "warning" | "note" => "warning"),
  Match.when("info", (): "error" | "warning" | "note" => "note"),
  Match.exhaustive,
)

const levelNumeric = Match.type<Severity>().pipe(
  Match.when("error", (): 1 | 2 | 3 => 1),
  Match.when("warn", (): 1 | 2 | 3 => 2),
  Match.when("info", (): 1 | 2 | 3 => 3),
  Match.exhaustive,
)

const levelCodeClimate = Match.type<Severity>().pipe(
  Match.when("error", (): "major" | "minor" | "info" => "major"),
  Match.when("warn", (): "major" | "minor" | "info" => "minor"),
  Match.when("info", (): "major" | "minor" | "info" => "info"),
  Match.exhaustive,
)

/** SARIF's levels, one per protocol severity. */
export const severity01 = (severity: Severity): "error" | "warning" | "note" => level01(severity)

/** LSP's numeric severity: 1 error, 2 warning, 3 information. */
export const severityNumeric = (severity: Severity): 1 | 2 | 3 => levelNumeric(severity)

/** Code Climate's three buckets, one per protocol severity. */
export const severityCodeClimate = (severity: Severity): "major" | "minor" | "info" =>
  levelCodeClimate(severity)

/* SARIF 2.1.0 — the OASIS interchange GitHub code scanning and most IDEs ingest. */

/** A SARIF text blob; the schema wraps every string in one. */
interface SarifText {
  readonly text: string
}

/** One rule descriptor. The optional fields are absent (not `undefined`) when unknown. */
interface SarifRule {
  readonly id: string
  readonly name: string
  readonly shortDescription: SarifText
  help?: SarifText
  helpUri?: string
}

/** A source span. `endLine`/`endColumn` are absent when the engine measured no span. */
interface SarifRegion {
  readonly startLine: number
  readonly startColumn: number
  endLine?: number
  endColumn?: number
}

/** The extension point SARIF gives a tool; where the report's own facts ride out. */
interface SarifResultProperties {
  fixable?: boolean
  judged?: boolean
  move?: Move
  score?: number
  baseline?: "known" | "novel"
}

interface SarifSuppression {
  readonly kind: string
  readonly status: string
  readonly justification: string
}

interface SarifLocation {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string }
    readonly region: SarifRegion
  }
}

interface SarifResult {
  readonly ruleId: string
  readonly level: "error" | "warning" | "note"
  readonly message: SarifText
  properties?: SarifResultProperties
  suppressions?: ReadonlyArray<SarifSuppression>
  readonly locations: ReadonlyArray<SarifLocation>
}

interface SarifDocument {
  readonly $schema: string
  readonly version: string
  readonly runs: ReadonlyArray<{
    readonly tool: {
      readonly driver: {
        readonly name: string
        readonly version: string
        readonly informationUri: string
        readonly rules: ReadonlyArray<SarifRule>
      }
    }
    readonly results: ReadonlyArray<SarifResult>
  }>
}

/**
 * Map a report to a SARIF 2.1.0 document.
 *
 * `known` is the accepted baseline, as a set of identities. When it is given, every result
 * carries `properties.baseline` and a known result is marked suppressed rather than hidden:
 * the reviewer sees accepted debt grayed out, not deleted.
 *
 * `properties` also carries the judged provenance (`judged`, `move`, `score`) when the
 * finding has it — the extension point SARIF gives for exactly this, and the difference
 * between an outward report that says "judged" and one that quietly says "determined".
 */
export const projectSarif = (
  report: Report,
  known: ReadonlySet<string> | undefined = undefined,
): SarifDocument => {
  const rules = new Map<string, SarifRule>()
  for (const diagnostic of report.diagnostics) {
    const name = ruleNameOf(diagnostic)
    if (rules.has(name)) continue
    const rule: SarifRule = {
      id: name,
      name,
      shortDescription: { text: diagnostic.message },
    }
    if (diagnostic.help !== undefined) rule.help = { text: diagnostic.help }
    if (diagnostic.docsUrl !== undefined) rule.helpUri = diagnostic.docsUrl
    rules.set(name, rule)
  }

  const results = report.diagnostics.map((diagnostic): SarifResult => {
    const isKnown = known !== undefined && known.has(identityOf(diagnostic))
    const properties: SarifResultProperties = {}
    if (diagnostic.fixable === true) properties.fixable = true
    if (diagnostic.judged !== undefined) properties.judged = diagnostic.judged
    if (diagnostic.move !== undefined) properties.move = diagnostic.move
    if (diagnostic.score !== undefined) properties.score = diagnostic.score
    if (known !== undefined) properties.baseline = isKnown ? "known" : "novel"

    const region: SarifRegion = {
      startLine: diagnostic.location.line,
      startColumn: diagnostic.location.column,
    }
    if (diagnostic.location.endLine !== undefined) region.endLine = diagnostic.location.endLine
    if (diagnostic.location.endColumn !== undefined)
      region.endColumn = diagnostic.location.endColumn

    const result: SarifResult = {
      ruleId: ruleNameOf(diagnostic),
      level: severity01(diagnostic.severity),
      message: { text: diagnostic.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: diagnostic.location.file },
            region,
          },
        },
      ],
    }
    if (Object.keys(properties).length > 0) result.properties = properties
    if (isKnown) {
      result.suppressions = [
        { kind: "external", status: "accepted", justification: "accepted in the baseline" },
      ]
    }
    return result
  })

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: DRIVER_NAME,
            version: String(report.lexicon.version),
            informationUri: INFORMATION_URI,
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  }
}

/* LSP 3.17 diagnostics — the editor contract, and a 1-based → 0-based shift. */

interface LspPosition {
  readonly line: number
  readonly character: number
}

interface LspDiagnostic {
  readonly range: { readonly start: LspPosition; readonly end: LspPosition }
  readonly severity: 1 | 2 | 3
  readonly code: string
  readonly source: string
  readonly message: string
  codeDescription?: { readonly href: string }
}

/**
 * Map a report to LSP diagnostics.
 *
 * The shift is the trap: the report is 1-based and LSP is 0-based, so a projection that
 * ships without it puts every squiggle one line and one column off. `end` falls back to
 * `start` when the engine measured no span, because LSP requires both ends.
 */
export const projectLsp = (report: Report): ReadonlyArray<LspDiagnostic> =>
  report.diagnostics.map((diagnostic) => {
    const { line, column, endLine, endColumn } = diagnostic.location
    const result: LspDiagnostic = {
      range: {
        start: { line: line - 1, character: column - 1 },
        end: { line: (endLine ?? line) - 1, character: (endColumn ?? column) - 1 },
      },
      severity: severityNumeric(diagnostic.severity),
      code: ruleNameOf(diagnostic),
      source: diagnostic.engine,
      message: diagnostic.message,
    }
    if (diagnostic.docsUrl !== undefined) result.codeDescription = { href: diagnostic.docsUrl }
    return result
  })

/* Code Climate / GitLab Code Quality — one dashboard's private shape. Generated, not
 * depended on; the fingerprint is the only part that matters, and it comes from the
 * finding's identity, never its line, because Code Climate deduplicates on it. */

interface CodeClimateLines {
  readonly begin: number
  end?: number
}

interface CodeClimateIssue {
  readonly type: "issue"
  readonly check_name: string
  readonly description: string
  readonly categories: ReadonlyArray<string>
  readonly location: { readonly path: string; readonly lines: CodeClimateLines }
  readonly severity: "major" | "minor" | "info"
  readonly fingerprint: string
}

/**
 * Map a report to Code Climate issues.
 *
 * No taxonomy in the report, so the category is the one a finding always is; a real mapping
 * belongs to the host that has one.
 */
export const projectCodeClimate = (report: Report): ReadonlyArray<CodeClimateIssue> =>
  report.diagnostics.map((diagnostic) => {
    const lines: CodeClimateLines = { begin: diagnostic.location.line }
    if (diagnostic.location.endLine !== undefined) lines.end = diagnostic.location.endLine
    return {
      type: "issue",
      check_name: ruleNameOf(diagnostic),
      description: diagnostic.message,
      categories: ["Style"],
      location: { path: diagnostic.location.file, lines },
      severity: severityCodeClimate(diagnostic.severity),
      fingerprint: identityOf(diagnostic),
    }
  })

/* Text serializers. Each projection is one shape written once; a host reads the string. */

/** Render any projection value as the canonical pretty-JSON the fixtures pin. */
const pretty = <Value>(value: Value): string => `${JSON.stringify(value, null, 2)}\n`

/** Render a report as SARIF 2.1.0. */
export const renderSarif = (
  report: Report,
  known: ReadonlySet<string> | undefined = undefined,
): string => pretty(projectSarif(report, known))

/** Render a report as LSP 3.17 diagnostics. */
export const renderLsp = (report: Report): string => pretty(projectLsp(report))

/** Render a report as Code Climate issues. */
export const renderCodeClimate = (report: Report): string => pretty(projectCodeClimate(report))

/** JSONL: one finding per line, the streaming form a runner writes. */
export const renderJsonl = (report: Report): string => `${toJsonl(report.diagnostics)}\n`
