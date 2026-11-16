import { describe, expect, it } from "vitest"
import { makeReport, type Diagnostic } from "@autotelic/protocol"
import { EXIT, type GateVerdict } from "./gate.ts"
import { renderGithub } from "./render.ts"

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

  it("keeps the engine's severity for a novel finding", () => {
    const text = renderGithub(report([finding({ identity: "novel" })]), {
      known: new Set(),
      gate: verdict({ exitCode: EXIT.findings, failing: [finding({ identity: "novel" })] }),
    })
    expect(text.startsWith("::error file=src/a.ts")).toBe(true)
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

  it("says the run had no verdict when an engine could not run", () => {
    const text = renderGithub(report([]), {
      gate: verdict({ exitCode: EXIT.infrastructure, infrastructure: ["plumb"] }),
    })
    expect(text).toContain("no verdict — engine(s) could not run: plumb (exit 3)")
  })
})
