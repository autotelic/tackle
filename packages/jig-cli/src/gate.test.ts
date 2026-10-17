import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "vitest"
import {
  accept,
  diffBaseline,
  makeReport,
  type Diagnostic,
  type EngineStatus,
  type EngineSummary,
  type Severity,
} from "@autotelic/protocol"
import { EXIT, gateVerdict, type GateOptions } from "./gate.ts"
import { touchedFiles } from "./git.ts"

/* The gate reads a run: a report and its diff against the ledger. These fixtures build
 * the smallest run that exercises one knob, so each test names the knob it is about. */

const diag = (input: {
  readonly engine?: string
  readonly ruleId: string
  readonly severity: Severity
  readonly file?: string
  readonly identity?: string
}): Diagnostic => {
  const base: Diagnostic = {
    engine: input.engine ?? "plumb",
    ruleId: input.ruleId,
    severity: input.severity,
    message: "m",
    location: { file: input.file ?? "a.ts", line: 1, column: 1 },
  }
  // Built in two statements rather than conditionally spread: `exactOptionalPropertyTypes`
  // distinguishes an absent `identity` from a present one, and plumb forbids the spread form.
  return input.identity === undefined ? base : { ...base, identity: input.identity }
}

const summary = (id: string, status: EngineStatus, diagnostics: number): EngineSummary => ({
  id,
  diagnostics,
  error: 0,
  warn: 0,
  info: 0,
  status,
})

const runOf = (
  diagnostics: ReadonlyArray<Diagnostic>,
  generators: ReadonlyArray<EngineSummary> = [summary("plumb", "ran", diagnostics.length)],
  accepted: ReadonlyArray<Diagnostic> = [],
) => ({
  report: makeReport({
    diagnostics,
    files: new Set(diagnostics.map((d) => d.location.file)).size,
    generators,
  }),
  diff: diffBaseline(accept(accepted), diagnostics),
})

const options = (over: Partial<GateOptions> = {}): GateOptions => ({
  mode: "all",
  failOn: "any-new",
  maxWarnings: -1,
  touched: new Set<string>(),
  ...over,
})

describe("gateVerdict", () => {
  it("passes a clean run", () => {
    const verdict = gateVerdict(runOf([]), options())
    expect(verdict.exitCode).toBe(EXIT.clean)
    expect(verdict.failing).toEqual([])
  })

  it("fails on a new finding under any-new, and holds an accepted one", () => {
    const known = diag({ ruleId: "no-x", severity: "warn", identity: "k" })
    const novel = diag({ ruleId: "no-y", severity: "info", identity: "n" })
    const verdict = gateVerdict(runOf([known, novel], undefined, [known]), options())
    expect(verdict.exitCode).toBe(EXIT.findings)
    expect(verdict.failing).toEqual([novel])
  })

  it("fails only on errors under error, even when they are accepted", () => {
    const accepted = diag({ ruleId: "no-x", severity: "error", identity: "k" })
    const warn = diag({ ruleId: "no-y", severity: "warn", identity: "w" })
    const verdict = gateVerdict(
      runOf([accepted, warn], undefined, [accepted]),
      options({ failOn: "error" }),
    )
    expect(verdict.failing).toEqual([accepted])
  })

  it("fails on errors and warnings under warn, and lets info through", () => {
    const info = diag({ ruleId: "no-z", severity: "info" })
    const warn = diag({ ruleId: "no-y", severity: "warn" })
    const verdict = gateVerdict(runOf([info, warn]), options({ failOn: "warn" }))
    expect(verdict.failing).toEqual([warn])
    expect(gateVerdict(runOf([info]), options({ failOn: "warn" })).exitCode).toBe(EXIT.clean)
  })

  it("narrows to the touched files when the mode says so", () => {
    const here = diag({ ruleId: "no-x", severity: "error", file: "src/here.ts" })
    const elsewhere = diag({ ruleId: "no-y", severity: "error", file: "src/elsewhere.ts" })
    const scoped = gateVerdict(
      runOf([here, elsewhere]),
      options({ mode: "touched-files", touched: new Set(["src/here.ts"]) }),
    )
    expect(scoped.failing).toEqual([here])
    expect(scoped.scope).toBe("touched-files")
  })

  it("fails on the warning ceiling even when nothing is new", () => {
    const warnings = [
      diag({ ruleId: "no-w", severity: "warn" }),
      diag({ ruleId: "no-w2", severity: "warn" }),
    ]
    const verdict = gateVerdict(runOf(warnings, undefined, warnings), options({ maxWarnings: 1 }))
    expect(verdict.exitCode).toBe(EXIT.findings)
    expect(verdict.failing).toEqual(warnings)
  })

  it("treats an engine that could not run as infrastructure, above any findings", () => {
    const novel = diag({ ruleId: "no-x", severity: "error" })
    const verdict = gateVerdict(
      runOf([novel], [summary("joggle", "errored", 0), summary("plumb", "ran", 1)]),
      options(),
    )
    expect(verdict.exitCode).toBe(EXIT.infrastructure)
    expect(verdict.infrastructure).toEqual(["joggle"])
  })

  it("does not hold a replayed engine against the run on its own", () => {
    const verdict = gateVerdict(runOf([], [summary("joggle", "replayed", 0)]), options())
    expect(verdict.exitCode).toBe(EXIT.clean)
    expect(verdict.infrastructure).toEqual([])
  })
})

describe("gateVerdict (property)", () => {
  const finding = fc.record({
    ruleId: fc.string({ minLength: 1, maxLength: 12 }),
    severity: fc.constantFrom<Severity>("error", "warn", "info"),
    file: fc.constantFrom("a.ts", "b.ts"),
  })

  it("never disagrees with the failing set, and holds only in-scope findings", () => {
    fc.assert(
      fc.property(
        fc.array(finding, { maxLength: 12 }),
        fc.constantFrom<GateOptions["failOn"]>("error", "warn", "any-new"),
        (findings, failOn) => {
          const run = runOf(findings.map((f) => diag(f)))
          const verdict = gateVerdict(run, options({ failOn }))
          const scope = new Set(run.report.diagnostics)
          for (const held of verdict.failing) expect(scope.has(held)).toBe(true)
          expect(verdict.exitCode === EXIT.clean).toBe(verdict.failing.length === 0)
        },
      ),
    )
  })
})

describe("touchedFiles", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect)

  const tempRepo = (): string => {
    const root = mkdtempSync(join(tmpdir(), "jig-git-"))
    const git = (...args: ReadonlyArray<string>): void => {
      execFileSync("git", args, { cwd: root, stdio: "ignore" })
    }
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    writeFileSync(join(root, "tracked.ts"), "x\n")
    git("add", "-A")
    git("commit", "-qm", "init")
    return root
  }

  it("reports modified and untracked files, relative to the root", async () => {
    const root = tempRepo()
    try {
      writeFileSync(join(root, "tracked.ts"), "y\n")
      writeFileSync(join(root, "fresh.ts"), "z\n")
      const touched = await run(touchedFiles(root).pipe(Effect.provide(NodeServices.layer)))
      expect(touched).toEqual(new Set(["tracked.ts", "fresh.ts"]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("returns undefined when the root is not a repository, so the gate widens to all", async () => {
    const root = mkdtempSync(join(tmpdir(), "jig-nogit-"))
    try {
      const touched = await run(touchedFiles(root).pipe(Effect.provide(NodeServices.layer)))
      expect(touched).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
