/* oxlint-disable plumb/prefer-property-tests -- the renderer's contract is one exact text for one exact report; a generated report would only assert the renderer agrees with itself. */
import { describe, expect, it } from "vitest"
import { makeReport, type Diagnostic } from "@autotelic/protocol"
import { EXIT, type GateVerdict } from "./gate.ts"
import { renderGithub, renderText } from "./render.ts"

/*
 * The GitHub form answers one question a reviewer cannot ask twice: which of these
 * annotations failed the run.
 *
 * A finding's severity is not the gate's decision. An identity the baseline already accepted
 * passes the gate, and printing it as `::error` painted a green pull request red — the
 * reader had to move the ledger aside to prove the annotation was decoration.
 */

const finding = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  engine: "plumb",
  ruleId: "require-deprecated-tag",
  severity: "error",
  message: "add @deprecated to the comment",
  location: { file: "src/a.ts", line: 3, column: 1 },
  ...overrides,
})

const verdict = (overrides: Partial<GateVerdict> = {}): GateVerdict => ({
  exitCode: EXIT.clean,
  scope: "all",
  failOn: "any-new",
  failing: [],
  advisory: [],
  infrastructure: [],
  ...overrides,
})

const report = (diagnostics: ReadonlyArray<Diagnostic>) =>
  makeReport({ diagnostics, files: 1, generators: [], elapsedMs: 0 })

describe("the GitHub projection separates held findings from failures", () => {
  it("annotates an accepted identity as a notice, not an error", () => {
    const held = finding({ identity: "accepted" })
    const text = renderGithub(report([held]), {
      known: new Set(["accepted"]),
      gate: verdict(),
    })
    expect(text).toContain("::notice file=src/a.ts,line=3,col=1,title=plumb/require-deprecated-tag")
    expect(text).toContain("(accepted in the baseline)")
    expect(text).not.toContain("::error file=src/a.ts")
  })

  it("marks a failing finding error even when the engine called it a notice", () => {
    // `failOn: any-new` holds by novelty, not severity: an info finding the gate holds must be
    // the red line, or the log shows a red gate with no red finding in it.
    const quiet = finding({ severity: "info", identity: "quiet" })
    const text = renderGithub(report([quiet]), {
      known: new Set(),
      gate: verdict({ exitCode: EXIT.findings, failing: [quiet] }),
    })
    expect(text.startsWith("::error file=src/a.ts")).toBe(true)
    expect(text).toContain("::error title=jig gate::")
  })

  it("keeps the engine's severity for a novel finding the gate does not hold", () => {
    const text = renderGithub(report([finding({ identity: "novel" })]), {
      known: new Set(),
      gate: verdict({ exitCode: EXIT.findings, failing: [finding({ identity: "novel" })] }),
    })
    expect(text.startsWith("::error file=src/a.ts")).toBe(true)
  })

  it("carries the census, so a step that skipped its rules cannot look clean", () => {
    const quiet = makeReport({
      diagnostics: [],
      files: 0,
      elapsedMs: 0,
      generators: [
        {
          id: "joggle",
          diagnostics: 0,
          error: 0,
          warn: 0,
          info: 0,
          status: "ran",
          note: "1 rule skipped",
        },
      ],
    })
    const text = renderGithub(quiet, { gate: verdict() })
    // An engine that never looked used to print nothing at all and exit 0.
    expect(text).toContain("::warning title=jig census (joggle)::1 rule skipped")
  })

  it("names where the failing findings are, not only how many", () => {
    const held = [
      finding({ identity: "a", location: { file: "src/one.ts", line: 3, column: 1 } }),
      finding({ identity: "b", location: { file: "src/two.ts", line: 9, column: 1 } }),
    ]
    const text = renderText(
      {
        report: report(held),
        diff: { novel: held, known: [], stale: [] },
      },
      {
        gate: verdict({ exitCode: EXIT.findings, failing: held }),
      },
    )
    expect(text).toContain("plumb/require-deprecated-tag: 2 failing findings")
    // A count with no place sends a reader through every file by hand.
    expect(text).toContain("src/one.ts:3, src/two.ts:9")
  })

  it("always says what the gate decided, so a held annotation is never the whole story", () => {
    const held = finding({ identity: "accepted" })
    const passed = renderGithub(report([held]), { known: new Set(["accepted"]), gate: verdict() })
    expect(passed).toContain("title=jig gate")
    expect(passed).toContain("gate passed; 1 baselined finding(s) reported, not held (exit 0)")

    const failed = renderGithub(report([finding({ identity: "novel" })]), {
      known: new Set(),
      gate: verdict({ exitCode: EXIT.findings, failing: [finding({ identity: "novel" })] }),
    })
    expect(failed).toContain("::error title=jig gate::failOn any-new, scope all: 1 finding(s)")
  })

  it("says what a scoped run read, and never reads the ledger as stale in one", () => {
    const stale = ["plumb/require-deprecated-tag:src/elsewhere.ts"]
    const scoped = renderText(
      {
        report: report([finding({ identity: "novel" })]),
        diff: { novel: [finding({ identity: "novel" })], known: [], stale },
      },
      { gate: verdict({ scope: "touched-files" }), scope: "pull request #1862: 3 file(s)" },
    )
    // "0 findings" over three changed files and over the whole repository look identical;
    // only one of them means the tree is clean.
    expect(scoped).toContain("scope — pull request #1862: 3 file(s)")
    // Every identity outside the slice would read as stale, so a scoped run must not say so.
    expect(scoped).not.toContain("no longer fire")

    const whole = renderText(
      { report: report([]), diff: { novel: [], known: [], stale } },
      { gate: verdict() },
    )
    expect(whole).toContain("1 baselined finding(s) no longer fire")
  })

  it("puts what was not judged in the headline, where a zero cannot hide it", () => {
    const quiet = makeReport({
      diagnostics: [],
      files: 0,
      generators: [{ id: "joggle", diagnostics: 0, error: 0, warn: 0, info: 0, unjudged: 11_946 }],
    })
    const text = renderText({ report: quiet, diff: { novel: [], known: [], stale: [] } })
    // "0 findings" from an unjudged half is not an architectural verdict; a trailing engine
    // note is easy to scroll past, the headline is not.
    expect(text.split("\n")[0]).toContain("11946 candidate(s) not judged")
  })

  it("says how much a scoped run set aside, so its zero is not the repository's", () => {
    const text = renderText(
      { report: report([]), diff: { novel: [], known: [], stale: [] } },
      { gate: verdict(), scope: "pull request #1862: 3 file(s)", outOfScope: 412 },
    )
    expect(text).toContain("412 finding(s) outside this scope")
    expect(text).toContain("run without a scope for the repository")
  })

  it("names rules that are reported but cannot fail this gate", () => {
    const warned = [
      finding({ ruleId: "no-stray-inline-comments", severity: "warn" }),
      finding({ ruleId: "no-stray-inline-comments", severity: "warn" }),
    ]
    const text = renderText(
      { report: report(warned), diff: { novel: [], known: [], stale: [] } },
      // failOn error: a warning is shown and enforced by nothing.
      { gate: verdict({ failOn: "error" }) },
    )
    expect(text).toContain("2 finding(s) reported and cannot fail this gate (failOn: error)")
    expect(text).toContain("plumb/no-stray-inline-comments 2")
  })

  it("says the run had no verdict when an engine could not run", () => {
    const text = renderGithub(report([]), {
      gate: verdict({ exitCode: EXIT.infrastructure, infrastructure: ["plumb"] }),
    })
    expect(text).toContain("no verdict — engine(s) could not run: plumb (exit 3)")
  })
})
