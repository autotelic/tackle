import fc from "fast-check"
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
    expect(lexiconRef("report")).toEqual({ name: "report", version: 2 })
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
    expect(isReadable({ seen: { name: "report", version: 2 }, known })).toBe(true)
    expect(isReadable({ seen: { name: "report", version: 1 }, known })).toBe(true)
    expect(isReadable({ seen: { name: "baseline", version: 1 }, known })).toBe(false)
    expect(names(known, "report")).toBe(true)
  })
})

describe("isReadable (property)", () => {
  it("reads any version of the same lexicon, and nothing else", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEXICON_NAMES),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (name, version, known) => {
          // Version is not the question: an older record was written to a schema the reader's is a
          // superset of, and a newer one only ever added optional fields. The name is the question.
          expect(isReadable({ seen: { name, version }, known: { name, version: known } })).toBe(true)
        },
      ),
    )
  })

  it("never reads a different lexicon, at any version", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEXICON_NAMES),
        fc.constantFrom(...LEXICON_NAMES),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (seen, known, seenVersion, knownVersion) => {
          fc.pre(seen !== known)
          expect(
            isReadable({
              seen: { name: seen, version: seenVersion },
              known: { name: known, version: knownVersion },
            }),
          ).toBe(false)
        },
      ),
    )
  })
})
