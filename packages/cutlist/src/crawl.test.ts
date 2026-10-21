import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { isTestPath } from "./crawl.ts"

/*
 * A test file is source, but it is not a part of the UI model. The catalog is derived from
 * what the app is made of; a test that imports a component is evidence about the test, and
 * counting it would draw test files as components and test imports as owners.
 */

describe("isTestPath", () => {
  it("recognises the test and spec suffixes", () => {
    expect(isTestPath("app/components/AuditLogTable.test.tsx")).toBe(true)
    expect(isTestPath("app/hooks/useSearchParamsCodec.test.ts")).toBe(true)
    expect(isTestPath("app/components/Card.spec.tsx")).toBe(true)
  })

  it("leaves a component whose name merely contains 'test' alone", () => {
    expect(isTestPath("app/components/Testimonial.tsx")).toBe(false)
    expect(isTestPath("app/components/testing/card.tsx")).toBe(false)
    expect(isTestPath("app/routes/test-results.tsx")).toBe(false)
  })

  it("recognises any path ending in a test suffix", () => {
    fc.assert(
      fc.property(fc.string(), (stem) => {
        expect(isTestPath(`${stem}.test.ts`)).toBe(true)
        expect(isTestPath(`${stem}.spec.tsx`)).toBe(true)
      }),
    )
  })
})
