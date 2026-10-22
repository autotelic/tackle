import fc from "fast-check"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { accept, diffBaseline, ratchetViolations } from "@autotelic/protocol"
import {
  argsFor,
  engineDiagnostics,
  engineProvenance,
  normalize,
  parseEngineOutput,
  resolveEngineCommand,
} from "./engines.ts"

/* The exact shape `oxlint --format json` emits, with the position inside labels[0].span. */
const OXLINT = JSON.stringify({
  diagnostics: [
    {
      message: "Variable 'unused' is declared but never used.",
      code: "eslint(no-unused-vars)",
      severity: "warning",
      url: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html",
      help: "Consider removing this declaration.",
      filename: "/repo/app/a.ts",
      labels: [
        { label: "'unused' is declared here", span: { offset: 41, length: 6, line: 3, column: 9 } },
      ],
    },
  ],
  number_of_files: 1,
})

describe("parseEngineOutput", () => {
  it("reads an oxlint report and relativizes the path", () => {
    const diagnostics = parseEngineOutput(OXLINT, { engine: "plumb", root: "/repo" })
    expect(diagnostics).toEqual([
      {
        engine: "plumb",
        ruleId: "eslint/no-unused-vars",
        severity: "warn",
        message: "Variable 'unused' is declared but never used.",
        location: { file: "app/a.ts", line: 3, column: 9 },
        help: "Consider removing this declaration.",
        docsUrl: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html",
      },
    ])
  })

  it("reads a report document whose findings carry an inline location", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ruleId: "structure/no-index-barrel",
          severity: "error",
          message: "a barrel file",
          location: { file: "app/components/index.ts", line: 1, column: 1 },
          judged: false,
        },
      ],
    })
    const diagnostics = parseEngineOutput(stdout, { engine: "joggle", root: "/repo" })
    expect(diagnostics?.[0]?.location.file).toBe("app/components/index.ts")
    expect(diagnostics?.[0]?.severity).toBe("error")
  })

  it("reads JSONL, one finding per line", () => {
    const line = JSON.stringify({
      ruleId: "r",
      severity: "info",
      message: "m",
      location: { file: "a.ts", line: 2, column: 2 },
    })
    expect(parseEngineOutput(`${line}\n\n`, { engine: "engine", root: "/repo" })).toHaveLength(1)
  })

  it("does not repeat an engine's own prefix in the rule ids it reports", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ruleId: "joggle/import-cycle",
          severity: "error",
          message: "a cycle",
          location: { file: "a.ts", line: 1, column: 1 },
        },
      ],
    })
    const diagnostics = parseEngineOutput(stdout, { engine: "joggle", root: "/repo" }) ?? []
    // `engine` and `ruleId` are kept apart everywhere they are read -- the renderer,
    // `ruleNameOf`, the baseline, `explain` -- so an id that already carries the engine
    // is composed twice: `joggle/joggle/import-cycle`, a name no document uses and
    // `explain joggle/import-cycle` cannot find.
    expect(diagnostics.map((entry) => `${entry.engine}/${entry.ruleId}`)).toEqual([
      "joggle/import-cycle",
    ])
  })

  it("returns undefined for output it does not recognize, so the caller can say so", () => {
    expect(
      parseEngineOutput("just some prose\nand more", { engine: "engine", root: "/repo" }),
    ).toBeUndefined()
  })

  it("returns nothing for a silent engine", () => {
    expect(parseEngineOutput("", { engine: "engine", root: "/repo" })).toEqual([])
  })
})

describe("normalize", () => {
  it("drops an entry with no message rather than inventing one", () => {
    expect(normalize({ code: "x" }, { engine: "e", root: "/repo" })).toBeUndefined()
  })
})

describe("engineDiagnostics", () => {
  it("does not read a silent, failed engine as clean", () => {
    const diagnostics = engineDiagnostics({
      id: "joggle",
      output: { code: 1, stdout: "", stderr: "boom: no tsconfig in sight" },
      root: "/repo",
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.ruleId).toBe("unparsed-output")
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.help).toBe("boom: no tsconfig in sight")
  })

  it("names the exit code when a failed engine printed nothing at all", () => {
    const diagnostics = engineDiagnostics({
      id: "joggle",
      output: { code: 2, stdout: "", stderr: "" },
      root: "/repo",
    })
    expect(diagnostics[0]?.message).toBe("joggle exited 2 without output")
    expect(diagnostics[0]?.help).toBeUndefined()
  })

  it("reads a silent, successful engine as clean", () => {
    expect(
      engineDiagnostics({
        id: "joggle",
        output: { code: 0, stdout: "", stderr: "" },
        root: "/repo",
      }),
    ).toEqual([])
  })

  it("keeps the findings an engine printed, whatever it exited with", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ruleId: "r",
          severity: "warn",
          message: "m",
          location: { file: "a.ts", line: 1, column: 1 },
        },
      ],
    })
    expect(
      engineDiagnostics({
        id: "joggle",
        output: { code: 1, stdout: stdout, stderr: "" },
        root: "/repo",
      }),
    ).toHaveLength(1)
  })

  it("reads an empty but understood report on a clean exit as clean", () => {
    expect(
      engineDiagnostics({
        id: "oxlint-engine",
        output: { code: 0, stdout: JSON.stringify({ diagnostics: [] }), stderr: "" },
        root: "/repo",
      }),
    ).toEqual([])
  })

  it("turns a failed cutlist into one stale-catalog error, not a parse attempt", () => {
    const diagnostics = engineDiagnostics({
      id: "cutlist",
      output: { code: 1, stdout: "the catalog is stale\n", stderr: "" },
      root: "/repo",
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.ruleId).toBe("stale-catalog")
    expect(diagnostics[0]?.severity).toBe("error")
  })
})

describe("argsFor", () => {
  it("passes an oxlint plugin's config file, which oxlint would otherwise have to discover", () => {
    expect(argsFor({ id: "plumb", kind: "oxlint-plugin", config: ".oxlintrc.json" })).toEqual([
      "--format",
      "json",
      "--config",
      ".oxlintrc.json",
    ])
  })

  it("does not invent a config flag for a process engine", () => {
    expect(argsFor({ id: "joggle", kind: "process", config: "joggle.config.json" })).toEqual([
      "check",
      "--format",
      "json",
    ])
  })

  it("appends a plugin's configured args to its base args", () => {
    expect(
      argsFor({ id: "plumb", kind: "oxlint-plugin", args: ["--ignore-pattern", "examples/**"] }),
    ).toEqual(["--format", "json", "--ignore-pattern", "examples/**"])
  })

  it("appends a process engine's configured args to its base args", () => {
    expect(argsFor({ id: "joggle", kind: "process", args: ["--scope", "src"] })).toEqual([
      "check",
      "--format",
      "json",
      "--scope",
      "src",
    ])
  })

  it("leaves the base args alone when the engine declares none", () => {
    expect(argsFor({ id: "joggle", kind: "process" })).toEqual(["check", "--format", "json"])
  })
})

describe("resolveEngineCommand", () => {
  it("prefers the project's own install and falls back to the bare command", () => {
    const root = mkdtempSync(join(tmpdir(), "jig-engine-"))
    try {
      const bin = join(root, "node_modules", ".bin")
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, "oxlint"), "#!/bin/sh\n")
      expect(resolveEngineCommand({ root: root, command: "oxlint" })).toBe(join(bin, "oxlint"))
      expect(resolveEngineCommand({ root: root, command: "not-installed-here" })).toBe(
        "not-installed-here",
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("the ratchet wiring", () => {
  it("fails on a novel identity and holds on a known one", () => {
    const finding = {
      engine: "joggle",
      ruleId: "no-dupes",
      severity: "error" as const,
      message: "two of these",
      location: { file: "a.ts", line: 1, column: 1 },
      identity: "dupe-cluster-1",
    }
    const baseline = accept([finding])
    expect(ratchetViolations(diffBaseline(baseline, [finding]))).toEqual([])
    const novel = { ...finding, identity: "dupe-cluster-2" }
    expect(ratchetViolations(diffBaseline(baseline, [finding, novel]))).toEqual([
      "joggle/no-dupes: 1 new finding not in the baseline",
    ])
  })
})

describe("parseEngineOutput (property)", () => {
  it("never throws, and answers only a list or undefined", () => {
    fc.assert(
      fc.property(fc.string(), (stdout) => {
        const result = parseEngineOutput(stdout, { engine: "x", root: "/repo" })
        expect(result === undefined || Array.isArray(result)).toBe(true)
      }),
    )
  })
})

describe("engineProvenance", () => {
  it("surfaces a content-mapper coverage note from the engine's own census", () => {
    const provenance = engineProvenance(
      JSON.stringify({
        diagnostics: [],
        summary: {
          notes: [
            {
              ruleId: "joggle",
              reason:
                "tsconfig declares content mappers for .vue; joggle indexes TypeScript and Astro only",
            },
          ],
        },
      }),
    )
    expect(provenance.note).toContain("content mappers")
  })

  it("keeps the skipped-rule note when there is no coverage note", () => {
    const provenance = engineProvenance(
      JSON.stringify({ diagnostics: [], summary: { skipped: [{ ruleId: "a" }, { ruleId: "b" }] } }),
    )
    expect(provenance.note).toBe("2 rules skipped")
  })
})
