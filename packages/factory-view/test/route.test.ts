/* oxlint-disable plumb/prefer-property-tests -- route parsing is a finite set of string shapes; the examples are the whole grammar. */
import { describe, expect, it } from "vitest"
import { workstreamOfPath, workstreamPath } from "../src/route.ts"

describe("workstream paths", () => {
  it("round-trips an id through the panel path", () => {
    expect(workstreamPath("perms-1862")).toBe("/factory/workstream/perms-1862")
    expect(workstreamOfPath(workstreamPath("perms-1862"))).toEqual({
      _tag: "Panel",
      id: "perms-1862",
    })
    expect(workstreamOfPath("/factory/workstream/perms%201862")).toEqual({
      _tag: "Panel",
      id: "perms 1862",
    })
  })

  it("treats the overview and malformed paths as no panel", () => {
    expect(workstreamOfPath("/factory")).toEqual({ _tag: "None" })
    expect(workstreamOfPath("/factory/")).toEqual({ _tag: "None" })
    expect(workstreamOfPath("/factory/workstream/")).toEqual({ _tag: "None" })
    expect(workstreamOfPath("/factory/workstream/a/b")).toEqual({ _tag: "None" })
    expect(workstreamOfPath("/factory/workstream/%")).toEqual({ _tag: "None" })
  })

  it("ignores a trailing slash so a shared link is forgiving", () => {
    expect(workstreamOfPath("/factory/workstream/perms-1862/")).toEqual({
      _tag: "Panel",
      id: "perms-1862",
    })
  })
})
