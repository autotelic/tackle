import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { commonRootOf } from "./paths.ts"

describe("commonRootOf", () => {
  it("keeps a single source root whole", () => {
    expect(commonRootOf(["src"])).toBe("src")
    expect(commonRootOf(["services/ui/app"])).toBe("services/ui/app")
  })

  it("finds the ancestor a multi-root tree shares", () => {
    // The config that exposed the bug: listing `components` first made it the app root,
    // so `components/ui` stopped matching and every part read as local or orphaned.
    expect(commonRootOf(["components", "app", "lib"])).toBe("")
    expect(commonRootOf(["src/components", "src/app"])).toBe("src")
  })

  it("does not invent a root from nothing", () => {
    expect(commonRootOf([])).toBe("")
  })

  it("answers an ancestor of every root", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]+$/u), { minLength: 1, maxLength: 5 }),
        (roots) => {
          const common = commonRootOf(roots)
          return roots.every(
            (root) => common === "" || root === common || root.startsWith(`${common}/`),
          )
        },
      ),
    )
  })
})
