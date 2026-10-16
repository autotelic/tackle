import { describe, expect, it } from "vitest"
import {
  isLexiconName,
  isLexiconRef,
  isReadable,
  LEXICON_NAMES,
  LEXICONS,
  lexiconRef,
  names,
} from "./lexicon.ts"

describe("the lexicon registry", () => {
  it("gives every lexicon a name equal to its key", () => {
    for (const name of LEXICON_NAMES) expect(LEXICONS[name].name).toBe(name)
  })

  it("versions each lexicon on its own line", () => {
    expect(lexiconRef("report")).toEqual({ name: "report", version: 1 })
    expect(lexiconRef("catalog")).toEqual({ name: "catalog", version: 1 })
    // The independence that matters: they are separate references, not one constant.
    expect(lexiconRef("report")).not.toEqual(lexiconRef("catalog"))
  })

  it("recognizes only known names and well-formed refs", () => {
    expect(isLexiconName("report")).toBe(true)
    expect(isLexiconName("report.v2")).toBe(false)
    expect(isLexiconRef({ name: "report", version: 1 })).toBe(true)
    expect(isLexiconRef({ name: "report", version: 0 })).toBe(false)
    expect(isLexiconRef({ name: "nope", version: 1 })).toBe(false)
    expect(isLexiconRef({ version: 1 })).toBe(false)
  })

  it("reads a same-name, not-older record and nothing else", () => {
    const known = lexiconRef("report")
    expect(isReadable({ name: "report", version: 2 }, known)).toBe(true)
    expect(isReadable({ name: "report", version: 1 }, known)).toBe(true)
    expect(isReadable({ name: "baseline", version: 1 }, known)).toBe(false)
    expect(names(known, "report")).toBe(true)
  })
})
