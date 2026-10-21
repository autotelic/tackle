import { describe, expect, it } from "vitest"
import type { CatalogComponent } from "@autotelic/protocol"
import { decodeIntentFiles, validateIntent } from "./intent.ts"

/*
 * The intent reader's pure half. The point of the module is that a file a person wrote is
 * never silently dropped: a bad file lands in `malformed`, where the CLI can fail loudly,
 * and a file that is not JSON at all is simply not an intent record.
 */

describe("decodeIntentFiles", () => {
  it("keys decoded intent by the file's basename", () => {
    const set = decodeIntentFiles([{ name: "button.json", text: '{"summary":"Click it."}' }])
    expect([...set.byName.keys()]).toEqual(["button"])
    expect(set.byName.get("button")).toEqual({ summary: "Click it." })
    expect(set.malformed).toEqual([])
  })

  it("ignores a file that is not JSON", () => {
    const set = decodeIntentFiles([{ name: "README.md", text: "# nope" }])
    expect(set.byName.size).toBe(0)
    expect(set.malformed).toEqual([])
  })

  it("reports unparseable and empty files instead of dropping them", () => {
    const set = decodeIntentFiles([
      { name: "bad.json", text: "{nope" },
      { name: "empty.json", text: "{}" },
      { name: "good.json", text: '{"summary":"fine"}' },
    ])
    expect(set.malformed).toEqual(["bad.json", "empty.json"])
    expect([...set.byName.keys()]).toEqual(["good"])
  })
})

describe("validateIntent", () => {
  const component = (
    name: string,
    path: string,
    exports: ReadonlyArray<string> = [],
  ): CatalogComponent => ({
    id: path,
    path,
    name,
    tier: "shared",
    owners: [],
    props: [],
    tags: [],
    signature: [],
    documented: false,
    exports,
  })

  const components = [
    component("Button", "src/components/button.tsx", ["Button"]),
    component("OldButton", "src/components/old-button.tsx", ["OldButton"]),
  ]

  it("accepts ids, names and exported names", () => {
    const issues = validateIntent({
      byName: new Map([
        ["src/components/old-button.tsx", { status: "deprecated", useInstead: ["Button"] }],
        ["Button", { summary: "The one button." }],
      ]),
      components,
    })
    expect(issues).toEqual({ stale: [], unknownTargets: [], stranded: [] })
  })

  it("reports a key that names no part and a target that does not exist", () => {
    const issues = validateIntent({
      byName: new Map([
        ["Gone", { summary: "No longer here." }],
        ["Button", { status: "deprecated", useInstead: ["Ghost"] }],
      ]),
      components,
    })
    expect(issues.stale).toEqual(["Gone"])
    expect(issues.unknownTargets).toEqual(["Button -> Ghost"])
  })

  it("reports a deprecated part with no migration target", () => {
    const issues = validateIntent({
      byName: new Map([["OldButton", { status: "deprecated" }]]),
      components,
    })
    expect(issues.stranded).toEqual(["OldButton"])
  })
})
