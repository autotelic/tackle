import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { afterRouteDir, commonRootOf, isRouteEntry, underAnyRoot } from "./paths.ts"

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

describe("underAnyRoot", () => {
  it("matches a tier inside any source root", () => {
    expect(
      underAnyRoot({
        modulePath: "apps/shop/ui/app/components/ui/button.tsx",
        roots: ["apps/auth/ui/app", "apps/shop/ui/app"],
        targets: ["components/ui"],
      }),
    ).toBe(true)
  })

  it("still matches a target that spans sibling roots", () => {
    expect(
      underAnyRoot({
        modulePath: "components/ui/button.tsx",
        roots: ["components", "app"],
        targets: ["components/ui"],
      }),
    ).toBe(true)
  })

  it("does not match a lookalike at a non-boundary", () => {
    expect(
      underAnyRoot({
        modulePath: "apps/shop/ui/app/lib/components/ui/button.tsx",
        roots: ["apps/shop/ui/app"],
        targets: ["components/ui"],
      }),
    ).toBe(false)
  })
})

describe("afterRouteDir", () => {
  it("reads the route tail from the containing app root", () => {
    expect(
      afterRouteDir({
        modulePath: "apps/auth/ui/app/routes/login._index.tsx",
        roots: ["apps/auth/ui/app", "apps/shop/ui/app"],
        routeDir: "routes",
      }),
    ).toBe("login._index.tsx")
  })

  it("distinguishes the route directory itself", () => {
    expect(
      afterRouteDir({
        modulePath: "apps/auth/ui/app/routes",
        roots: ["apps/auth/ui/app"],
        routeDir: "routes",
      }),
    ).toBe("")
  })

  it("answers undefined outside the route directory", () => {
    expect(
      afterRouteDir({
        modulePath: "apps/auth/ui/app/components/Button.tsx",
        roots: ["apps/auth/ui/app"],
        routeDir: "routes",
      }),
    ).toBeUndefined()
  })
})

describe("isRouteEntry", () => {
  const roots = ["apps/shop/ui/app"]
  const routeDir = "routes"

  it("accepts a flat route file", () => {
    expect(
      isRouteEntry({
        modulePath: "apps/shop/ui/app/routes/account.orders._index.tsx",
        roots,
        routeDir,
      }),
    ).toBe(true)
  })

  it("accepts a nested route module", () => {
    expect(
      isRouteEntry({
        modulePath: "apps/shop/ui/app/routes/account.orders/route.tsx",
        roots,
        routeDir,
      }),
    ).toBe(true)
  })

  it("does not accept a component owned by a route", () => {
    expect(
      isRouteEntry({
        modulePath: "apps/shop/ui/app/routes/account.orders/components/order-row.tsx",
        roots,
        routeDir,
      }),
    ).toBe(false)
  })
})
