import { describe, expect, it } from "vitest"
import { derivePin, pinMatches } from "./pin.ts"

const lock = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      "@autotelic/protocol":
        specifier: workspace:*
        version: 0.0.0
packages:
  "@autotelic/protocol@0.0.0":
    resolution: {integrity: sha512-abc}
`

describe("pin", () => {
  it("derives version and integrity from the lockfile", () => {
    expect(derivePin(lock, "@autotelic/protocol")).toEqual({
      name: "@autotelic/protocol",
      version: "0.0.0",
      integrity: "sha512-abc",
      importer: ".",
      lockfile: "pnpm-lock.yaml",
    })
  })

  it("treats a changed integrity as drift", () => {
    const pin = derivePin(lock, "@autotelic/protocol")!
    expect(pinMatches(pin, { ...pin, integrity: "sha512-other" })).toBe(false)
  })

  it("returns undefined for a name the lockfile does not resolve", () => {
    expect(derivePin(lock, "@autotelic/missing")).toBeUndefined()
  })
})
