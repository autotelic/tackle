import { describe, expect, it } from "vitest"
import { cutlistDefaultOutput } from "@autotelic/protocol"
import {
  GENERATED_BEGIN,
  GENERATED_END,
  generatedRules,
  mergeGitattributes,
} from "./gitattributes.ts"

const rules = generatedRules(cutlistDefaultOutput)

describe("generatedRules", () => {
  it("collapses the projections and leaves authored intent reviewable", () => {
    const text = rules.join("\n")
    expect(text).toContain("tools/ui-catalog/catalog.json linguist-generated=true")
    expect(text).toContain("tools/ui-catalog/plumb-ui.config.json linguist-generated=true")
    expect(text).not.toContain("tools/ui-catalog/intent")
  })

  it("leaves diagrams out until the repo opts in", () => {
    expect(rules.join("\n")).not.toContain("diagrams")
  })

  it("marks the diagram directory as generated but only the SVG as undiffable", () => {
    const text = generatedRules({
      ...cutlistDefaultOutput,
      diagrams: "tools/ui-catalog/diagrams",
    }).join("\n")
    expect(text).toContain("tools/ui-catalog/diagrams/** linguist-generated=true")
    expect(text).toContain("tools/ui-catalog/diagrams/**/*.svg -diff")
    expect(text).not.toContain(".mmd -diff")
  })
})

describe("mergeGitattributes", () => {
  it("creates the file with the managed block when none exists", () => {
    const merged = mergeGitattributes(undefined, rules)
    expect(merged.action).toBe("created")
    expect(merged.body).toContain(GENERATED_BEGIN)
    expect(merged.body).toContain(GENERATED_END)
    expect(merged.body.endsWith("\n")).toBe(true)
  })

  it("appends without touching the rules already there", () => {
    const existing = "* text=auto eol=lf\n\n*.png binary\n"
    const merged = mergeGitattributes(existing, rules)
    expect(merged.action).toBe("appended")
    expect(merged.body.startsWith(existing)).toBe(true)
    expect(merged.body).toContain(GENERATED_BEGIN)
    expect(merged.body).toContain("*.png binary")
  })

  it("replaces only the block it owns", () => {
    const first = mergeGitattributes("*.png binary\n", rules).body
    const narrowed = generatedRules({
      ...cutlistDefaultOutput,
      catalog: "docs/catalog.json",
    })
    const second = mergeGitattributes(first, narrowed)
    expect(second.action).toBe("updated")
    expect(second.body).toContain("*.png binary")
    expect(second.body).toContain("docs/catalog.json linguist-generated=true")
    expect(second.body).not.toContain("tools/ui-catalog/catalog.json")
    // Exactly one block, however many times init runs.
    expect(second.body.split(GENERATED_BEGIN)).toHaveLength(2)
  })

  it("is idempotent", () => {
    const once = mergeGitattributes(undefined, rules).body
    expect(mergeGitattributes(once, rules).action).toBe("unchanged")
  })

  it("leaves a half-written block alone rather than guessing", () => {
    const existing = `${GENERATED_BEGIN}\ntools/ui-catalog/** linguist-generated=true\n`
    const merged = mergeGitattributes(existing, rules)
    expect(merged.action).toBe("malformed")
    expect(merged.body).toBe(existing)
  })

  it("keeps the file's own line endings", () => {
    const merged = mergeGitattributes("*.png binary\r\n", rules)
    expect(merged.body).toContain("\r\n")
    expect(merged.body.replaceAll("\r\n", "")).not.toContain("\n")
  })
})
