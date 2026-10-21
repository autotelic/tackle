import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { parseJson } from "./json.ts"

/*
 * The seam's one JSON reader: a malformed committed file must be a miss, never a throw.
 * The property says that precisely — `undefined` exactly when `JSON.parse` would throw.
 */
describe("parseJson", () => {
  it("reads a record", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it("answers undefined for malformed text", () => {
    expect(parseJson("{")).toBeUndefined()
    expect(parseJson("")).toBeUndefined()
  })

  it("misses exactly when JSON.parse throws", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        try {
          JSON.parse(text)
        } catch {
          return parseJson(text) === undefined
        }
        return parseJson(text) !== undefined
      }),
    )
  })
})
