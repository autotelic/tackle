import { describe, expect, it } from "vitest"
import { decodeIntentFiles } from "./intent.ts"

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
