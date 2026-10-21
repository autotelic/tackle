import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { isTestPath, parseModule } from "./crawl.ts"

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

describe("default exports", () => {
  const declarations = (text: string) => parseModule({ filename: "x.tsx", text }).declarations

  it("marks a default-exported declaration as exported", () => {
    const found = declarations("const Badge = () => <span />\nexport default Badge")
    expect(found.find((declaration) => declaration.name === "Badge")).toMatchObject({
      exported: true,
      renders: true,
    })
  })

  it("marks an aliased default export", () => {
    const found = declarations("const Badge = () => <span />\nexport { Badge as default }")
    expect(found.find((declaration) => declaration.name === "Badge")).toMatchObject({
      exported: true,
      renders: true,
    })
  })

  it("keeps an anonymous default expression", () => {
    const found = declarations("export default () => <span />")
    expect(found.find((declaration) => declaration.name === "default")).toMatchObject({
      exported: true,
      renders: true,
    })
  })

  it("keeps a named default function", () => {
    const found = declarations("export default function Button() { return <button /> }")
    expect(found.find((declaration) => declaration.name === "Button")).toMatchObject({
      exported: true,
      renders: true,
    })
  })

  it("parses JSX in a plain .js file", () => {
    const found = parseModule({
      filename: "Button.js",
      text: "export default function Button() { return <button /> }",
    }).declarations
    expect(found.find((declaration) => declaration.name === "Button")).toMatchObject({
      exported: true,
      renders: true,
    })
  })
})
