import { describe, expect, it } from "vitest"
import { findProjectBin } from "./launcher.ts"

/* oxlint-disable plumb/prefer-property-tests -- this is a decision over a fixed tree shape, not a generated domain. */

const tree = (paths: ReadonlyArray<string>) => {
  const present = new Set(paths)
  return (path: string) => present.has(path)
}

describe("the project bin is found where the project actually is", () => {
  it("walks from a workspace package to the repository root", () => {
    const bin = findProjectBin({
      cwd: "/repo/packages/room",
      name: "room",
      exists: tree(["/repo/.git", "/repo/node_modules/.bin/room"]),
    })
    expect(bin).toEqual({ _tag: "Found", path: "/repo/node_modules/.bin/room" })
  })

  it("prefers the nearer package's bin over the root's", () => {
    const bin = findProjectBin({
      cwd: "/repo/packages/room",
      name: "room",
      exists: tree([
        "/repo/.git",
        "/repo/node_modules/.bin/room",
        "/repo/packages/room/node_modules/.bin/room",
      ]),
    })
    expect(bin).toEqual({ _tag: "Found", path: "/repo/packages/room/node_modules/.bin/room" })
  })

  it("does not let a nested repository borrow its host's bin", () => {
    const bin = findProjectBin({
      cwd: "/outer/nested",
      name: "room",
      exists: tree(["/outer/.git", "/outer/node_modules/.bin/room", "/outer/nested/.git"]),
    })
    expect(bin).toEqual({ _tag: "Missing" })
  })

  it("checks only cwd when no repository boundaries exist", () => {
    const bin = findProjectBin({
      cwd: "/scratch",
      name: "room",
      exists: tree(["/node_modules/.bin/room", "/scratch/node_modules/.bin/room"]),
    })
    expect(bin).toEqual({ _tag: "Found", path: "/scratch/node_modules/.bin/room" })
  })

  it("does not walk to the filesystem root without a repository", () => {
    const bin = findProjectBin({
      cwd: "/scratch/deeper",
      name: "room",
      exists: tree(["/node_modules/.bin/room"]),
    })
    expect(bin).toEqual({ _tag: "Missing" })
  })
})
