import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { engineDiagnostics, parseEngineOutput } from "./engines.ts"

/*
 * Every oxlint 1.88 output variety, captured against one file (`fixtures/oxlint/`).
 *
 * jig asks oxlint for `--format json`, so the question this suite answers is: when jig is
 * handed an engine it did not configure, which encodings can it still read, and does it
 * ever mistake one it cannot read for a clean run? The matrix is: READ = json, sarif,
 * gitlab (Code Climate), github; UNREAD = agent, unix, checkstyle, junit, default, stylish.
 * The unread half is deliberate — jig will not guess at XML or human prose — and the point
 * of these tests is that "did not read" is reported, not swallowed.
 */

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/oxlint/${file}`, import.meta.url)), "utf8")

const ROOT = "/repo"

const STRUCTURED = [
  ["json", "json.json"],
  ["sarif", "sarif.json"],
  ["gitlab", "gitlab.json"],
  ["github", "github.txt"],
] as const

const UNREAD = [
  ["agent", "agent.txt"],
  ["unix", "unix.txt"],
  ["checkstyle", "checkstyle.xml"],
  ["junit", "junit.xml"],
  ["default", "default.txt"],
  ["stylish", "stylish.txt"],
] as const

describe.each(STRUCTURED)("oxlint --format %s", (_format, file) => {
  const output = read(file)

  it("carries the two findings oxlint reported", () => {
    const diagnostics = parseEngineOutput(output, "oxlint", ROOT) ?? []
    expect(diagnostics.map((diagnostic) => diagnostic.ruleId).sort()).toEqual([
      "eslint/no-debugger",
      "eslint/no-unused-vars",
    ])
    expect(diagnostics.every((diagnostic) => diagnostic.engine === "oxlint")).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.location.file === "sample.js")).toBe(true)
    expect(diagnostics.map((diagnostic) => diagnostic.location.line).sort((a, b) => a - b)).toEqual(
      [1, 3],
    )
    expect(diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("never used")
    expect(diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("not allowed")
  })

  it("is never mistaken for unparsed output", () => {
    const diagnostics = engineDiagnostics("oxlint", 0, output, "", ROOT)
    expect(diagnostics.some((diagnostic) => diagnostic.ruleId === "oxlint/unparsed-output")).toBe(
      false,
    )
  })
})

describe.each(UNREAD)("oxlint --format %s", (_format, file) => {
  const output = read(file)

  it("is not read as diagnostics", () => {
    expect(parseEngineOutput(output, "oxlint", ROOT)).toBeUndefined()
  })

  it("is reported as unparsed, never silently clean", () => {
    const diagnostics = engineDiagnostics("oxlint", 0, output, "", ROOT)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.ruleId).toBe("oxlint/unparsed-output")
    expect(diagnostics[0]?.severity).toBe("info")
  })
})

describe("the plugin prefix", () => {
  it("does not repeat the engine name in a rule id", () => {
    // oxlint code `plumb(no-raw-html-layout)` on engine `plumb` is one namespace, not two.
    const code = JSON.stringify({
      diagnostics: [
        {
          message: "raw html",
          code: "plumb(no-raw-html-layout)",
          severity: "warning",
          filename: "a.tsx",
          labels: [{ span: { line: 1, column: 1 } }],
        },
        {
          message: "a sub-plugin rule",
          code: "plumb-ui(no-raw-interactive)",
          severity: "error",
          filename: "a.tsx",
          labels: [{ span: { line: 2, column: 1 } }],
        },
      ],
    })
    const diagnostics = parseEngineOutput(code, "plumb", ROOT) ?? []
    expect(diagnostics.map((diagnostic) => `${diagnostic.engine}/${diagnostic.ruleId}`)).toEqual([
      "plumb/no-raw-html-layout",
      "plumb/plumb-ui/no-raw-interactive",
    ])
  })
})
