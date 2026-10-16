import { describe, expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { manifestOf } from "../src/run-cache.ts"
import { sourceFingerprint } from "../src/fingerprint.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

describe("the tool's own source is part of the manifest", () => {
  test("the fingerprint is stable and is not the declared fallback", async () => {
    const declared = "2026-09-05"
    const first = await run(sourceFingerprint(declared))
    const second = await run(sourceFingerprint(declared))
    expect(first).toBe(second)
    // It hashed something. Returning the fallback would also be stable, and would
    // also mean the whole mechanism silently did nothing.
    expect(first).not.toBe(declared)
    expect(first.length).toBeGreaterThan(8)
  })

  test("a changed tool is a changed manifest", () => {
    const files = ["src/a.ts"]
    const contents = new Map([["src/a.ts", "export const a = 1"]])
    const before = manifestOf("/repo", files, contents, ["joggle/a"], "fp-one")
    const after = manifestOf("/repo", files, contents, ["joggle/a"], "fp-two")
    // This is the two-in-one-session bug: a rule changed, the version string did
    // not, and the run short-circuited to a report from the old rules.
    expect(after).not.toBe(before)
  })

  test("the same tool over the same files is the same manifest", () => {
    const files = ["src/a.ts", "src/b.ts"]
    const contents = new Map([
      ["src/a.ts", "export const a = 1"],
      ["src/b.ts", "export const b = 2"],
    ])
    const one = manifestOf("/repo", files, contents, ["joggle/a"], "fp")
    expect(manifestOf("/repo", files, contents, ["joggle/a"], "fp")).toBe(one)
  })

  test("the manifest still follows the code being analysed", () => {
    const files = ["src/a.ts"]
    const one = manifestOf("/repo", files, new Map([["src/a.ts", "x"]]), ["joggle/a"], "fp")
    const two = manifestOf("/repo", files, new Map([["src/a.ts", "y"]]), ["joggle/a"], "fp")
    expect(two).not.toBe(one)
  })

  test("the manifest still follows the selected rules", () => {
    const files = ["src/a.ts"]
    const contents = new Map([["src/a.ts", "x"]])
    const one = manifestOf("/repo", files, contents, ["joggle/a"], "fp")
    const two = manifestOf("/repo", files, contents, ["joggle/a", "joggle/b"], "fp")
    expect(two).not.toBe(one)
  })
})
