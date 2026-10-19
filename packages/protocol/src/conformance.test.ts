/* oxlint-disable plumb/prefer-property-tests -- the input is a frozen corpus validated against a schema; there is no generator to vary, the fixtures are the property. */
import { describe, expect, it } from "vitest"
import { EMPTY_MANIFEST } from "./catalog.ts"
import { LEXICON_NAMES, type LexiconName } from "./lexicon.ts"
import { compileLexicon, DECODERS, fixtureExists, loadJson, makeAjv } from "./fixture-support.ts"

/*
 * The conformance suite: every lexicon's real output, checked against the schema a
 * stranger would use, and its decoders, checked against junk.
 *
 * Two independent judges sit here. Ajv validates the bytes against `schema/*.json` — a
 * judge that is NOT the TypeScript. The decoders are the TypeScript's own reader. A change
 * that satisfies one and not the other is exactly the drift a single package's tests
 * cannot see.
 */

const ajv = makeAjv()

const goldenPath = (name: LexiconName): string => `fixtures/${name}/golden.json`
const legacyPath = (name: LexiconName): string => `fixtures/${name}/legacy.json`
const malformedPath = (name: LexiconName): string => `fixtures/${name}/malformed.json`

describe("the lexicon registry", () => {
  it("has a schema and a golden fixture for every lexicon", () => {
    for (const name of LEXICON_NAMES) {
      expect(fixtureExists(`schema/${name}.json`), `schema for ${name}`).toBe(true)
      expect(fixtureExists(goldenPath(name)), `golden fixture for ${name}`).toBe(true)
    }
  })

  it("points every schema's `$id` at the lexicon's name", () => {
    for (const name of LEXICON_NAMES) {
      const schema = loadJson(`schema/${name}.json`) as Record<string, unknown>
      expect(String(schema.$id).endsWith(`/${name}.json`), `$id for ${name}`).toBe(true)
    }
  })

  it("names the same lexicon in the registry and in every record it wrote", () => {
    for (const name of LEXICON_NAMES) {
      const golden = loadJson(goldenPath(name)) as Record<string, unknown>
      const ref = golden.lexicon as { readonly name?: string } | undefined
      if (ref !== undefined) {
        expect(ref.name, `lexicon name in ${name}.golden.json`).toBe(name)
        continue
      }
      // Authored configs name their lexicon by `$schema` instead of an embedded ref.
      const schemaId = golden.$schema
      if (typeof schemaId === "string") {
        expect(schemaId.endsWith(`/${name}.json`), `$schema for ${name}`).toBe(true)
        continue
      }
      // Only the manifest may identify itself by neither: its first readers predate
      // versioning and read a bare projection. Our projector still writes the ref.
      expect(name, `${name}.golden.json carries no lexicon reference`).toBe("manifest")
    }
  })
})

describe.each(LEXICON_NAMES)("%s", (name: LexiconName) => {
  const validate = compileLexicon(ajv, name)
  const decode = DECODERS[name]

  it("accepts the golden record", () => {
    const golden = loadJson(goldenPath(name))
    const ok = validate(golden)
    if (!ok) throw new Error(JSON.stringify(validate.errors))
    expect(decode(golden)).toBeDefined()
  })

  it("accepts a record written before per-lexicon versioning", () => {
    if (!fixtureExists(legacyPath(name))) return
    const legacy = loadJson(legacyPath(name))
    const ok = validate(legacy)
    if (!ok) throw new Error(JSON.stringify(validate.errors))
    expect(decode(legacy)).toBeDefined()
  })

  it("rejects a malformed record", () => {
    expect(validate(loadJson(malformedPath(name)))).toBe(false)
  })

  it("degrades a malformed record to silence, never a crash", () => {
    const decoded = decode(loadJson(malformedPath(name)))
    if (name === "manifest") {
      // The one reader that predates us fails open to its documented empty value.
      expect(decoded).toEqual(EMPTY_MANIFEST)
    } else {
      expect(decoded).toBeUndefined()
    }
  })

  it("refuses a record wearing another lexicon's name", () => {
    const golden = loadJson(goldenPath(name)) as Record<string, unknown>
    if (golden.lexicon === undefined) return // authored configs name their lexicon by `$schema`
    const other = LEXICON_NAMES.find((candidate) => candidate !== name)
    const forged = { ...golden, lexicon: { name: other, version: 1 } }
    expect(validate(forged)).toBe(false)
    const decoded = decode(forged)
    expect(decoded).toEqual(name === "manifest" ? EMPTY_MANIFEST : undefined)
  })
})

/*
 * The conformance matrix: each REAL engine output × the schema it must satisfy. A fixture
 * here came off an engine against `examples/self`, not out of a type. If an engine's bytes
 * and its schema drift apart, this is the row that goes red.
 */
describe("the engine-output conformance matrix", () => {
  const rows: ReadonlyArray<{
    readonly engine: string
    readonly lexicon: LexiconName
    readonly fixture: string
  }> = [
    { engine: "jig check", lexicon: "report", fixture: goldenPath("report") },
    { engine: "cutlist build", lexicon: "catalog", fixture: goldenPath("catalog") },
    { engine: "cutlist build", lexicon: "manifest", fixture: goldenPath("manifest") },
    // `onboarding` is a declared lexicon no engine serializes yet; `menu` is written by
    // `cutlist build`, and this fixture is what that engine emits against `examples/self`.
    { engine: "cutlist build", lexicon: "menu", fixture: goldenPath("menu") },
    { engine: "jig init", lexicon: "baseline", fixture: goldenPath("baseline") },
    { engine: "jig init", lexicon: "jig.config", fixture: goldenPath("jig.config") },
    { engine: "hand-authored", lexicon: "cutlist.config", fixture: goldenPath("cutlist.config") },
    { engine: "hand-authored", lexicon: "onboarding", fixture: goldenPath("onboarding") },
  ]

  it.each(rows)("$engine fixture is a valid $lexicon", ({ lexicon, fixture }) => {
    const validate = compileLexicon(ajv, lexicon)
    const ok = validate(loadJson(fixture))
    if (!ok) throw new Error(JSON.stringify(validate.errors))
  })
})
