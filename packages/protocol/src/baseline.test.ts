import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { accept, diffBaseline, identityOf, ratchetViolations } from "./baseline.ts"
import type { Diagnostic } from "./report.ts"

const at = (identity: string, overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  engine: "test",
  ruleId: "test/rule",
  severity: "error",
  message: "a finding",
  location: { file: "src/a.ts", line: 1, column: 1 },
  identity,
  ...overrides,
})

describe("identityOf", () => {
  it("prefers the declared identity over the fallback", () => {
    expect(identityOf(at("cluster-7"))).toBe("cluster-7")
    // A diagnostic that declared no identity falls back to engine + rule + file.
    const anonymous: Diagnostic = {
      engine: "test",
      ruleId: "test/rule",
      severity: "error",
      message: "a finding",
      location: { file: "src/a.ts", line: 1, column: 1 },
    }
    expect(identityOf(anonymous)).toBe("test/test/rule:src/a.ts")
  })
})

describe("diffBaseline", () => {
  it("splits novel from accepted and reports what no longer fires", () => {
    const baseline = accept([at("a"), at("b")])
    const diff = diffBaseline(baseline, [at("a"), at("c")])
    expect(diff.known.map(identityOf)).toEqual(["a"])
    expect(diff.novel.map(identityOf)).toEqual(["c"])
    expect(diff.stale).toEqual(["b"])
  })

  it("names the identity a gate must fix", () => {
    const baseline = accept([])
    const violations = ratchetViolations(
      diffBaseline(baseline, [at("new", { ruleId: "plumb/no-raw-html" })]),
    )
    expect(violations).toEqual(["test/plumb/no-raw-html: 1 new finding not in the baseline"])
  })

  it("holds when nothing is new", () => {
    const baseline = accept([at("a")])
    expect(ratchetViolations(diffBaseline(baseline, [at("a")]))).toEqual([])
  })
})

describe("the ratchet (property)", () => {
  it("holds when the baseline is exactly what fires", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string(), { maxLength: 20 }), (identities) => {
        const diagnostics = identities.map((identity) => at(identity))
        const diff = diffBaseline(accept(diagnostics), diagnostics)
        expect(diff.novel).toEqual([])
        expect(diff.stale).toEqual([])
      }),
    )
  })
})
