import { describe, expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { manifestOf, type ManifestInput } from "../src/run-cache.ts"
import { sourceFingerprint } from "../src/fingerprint.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

/** One run's inputs, with whatever the test is varying named explicitly. */
const over = (input: Partial<ManifestInput>): ManifestInput => ({
  root: "/repo",
  files: ["src/a.ts"],
  contents: new Map([["src/a.ts", "export const a = 1"]]),
  ruleIds: ["joggle/a"],
  tool: "fp",
  settings: "s",
  ...input,
})

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
    // This is the two-in-one-session bug: a rule changed, the version string did
    // not, and the run short-circuited to a report from the old rules.
    expect(manifestOf(over({ tool: "fp-two" }))).not.toBe(manifestOf(over({ tool: "fp-one" })))
  })

  test("the same tool over the same files is the same manifest", () => {
    expect(manifestOf(over({}))).toBe(manifestOf(over({})))
  })

  test("the manifest still follows the code being analysed", () => {
    const one = manifestOf(over({ contents: new Map([["src/a.ts", "x"]]) }))
    const two = manifestOf(over({ contents: new Map([["src/a.ts", "y"]]) }))
    expect(two).not.toBe(one)
  })

  test("the manifest still follows the selected rules", () => {
    const one = manifestOf(over({ ruleIds: ["joggle/a"] }))
    const two = manifestOf(over({ ruleIds: ["joggle/a", "joggle/b"] }))
    expect(two).not.toBe(one)
  })

  test("a changed configuration is a changed manifest", () => {
    // A severity moved, a path added to `ignore`, an architecture renamed: the rule
    // ids are identical and the report is not. Hashing the ids alone replayed the
    // stored run across the edit, so the next run showed a report for a
    // configuration that no longer existed -- findings at the old severity, a
    // silenced rule still silent.
    expect(manifestOf(over({ settings: "settings-two" }))).not.toBe(
      manifestOf(over({ settings: "settings-one" })),
    )
  })
})
