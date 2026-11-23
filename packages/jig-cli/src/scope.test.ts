/* oxlint-disable plumb/prefer-property-tests -- the subject is git's answer over a fixed temp repository; a generator would be testing git, not jig. */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { makeReport, type Diagnostic } from "@autotelic/protocol"
import { Effect } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { afterEach, describe, expect, it } from "vitest"
import { changedSince } from "./git.ts"
import { scopeReport } from "./run.ts"

const run = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
  Effect.runPromise(Effect.provide(effect, NodeServices.layer))

/*
 * A scope is a claim about what the run read.
 *
 * The failure both of these guard is the same one: a narrowed report that still describes the
 * whole tree. Counts that do not add up, or a change set that quietly answers "nothing", make
 * "0 findings" mean two different things in the same output shape.
 */

const finding = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  engine: "plumb",
  ruleId: "require-deprecated-tag",
  severity: "error",
  message: "add @deprecated to the comment",
  location: { file: "src/a.ts", line: 3, column: 1 },
  ...overrides,
})

describe("a scoped report keeps its census honest", () => {
  it("recounts each engine and leaves what it said about looking alone", () => {
    const report = makeReport({
      diagnostics: [
        finding({ identity: "a", location: { file: "src/a.ts", line: 3, column: 1 } }),
        finding({ identity: "b", location: { file: "src/b.ts", line: 9, column: 1 } }),
        finding({ identity: "c", engine: "joggle", severity: "warn" }),
      ],
      files: 2,
      generators: [
        { id: "plumb", diagnostics: 2, error: 2, warn: 0, info: 0, status: "ran" },
        // A claim about coverage, not about findings: it must survive the narrowing.
        {
          id: "joggle",
          diagnostics: 1,
          error: 0,
          warn: 1,
          info: 0,
          status: "replayed",
          unjudged: 12,
        },
      ],
      elapsedMs: 40,
    })

    const scoped = scopeReport(report, new Set(["src/a.ts"]))
    expect(scoped.diagnostics).toHaveLength(2)
    expect(scoped.counts).toEqual({ error: 1, warn: 1, info: 0 })
    expect(scoped.files).toBe(1)
    expect(scoped.generators.find((generator) => generator.id === "plumb")).toMatchObject({
      diagnostics: 1,
      error: 1,
    })
    // The engine's own account of what it did is not a count of this slice.
    expect(scoped.generators.find((generator) => generator.id === "joggle")).toMatchObject({
      diagnostics: 1,
      status: "replayed",
      unjudged: 12,
    })
  })
})

describe("changedSince reads the change in front of you", () => {
  const dirs: Array<string> = []
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "jig-scope-"))
    dirs.push(dir)
    const git = (...args: Array<string>) => execFileSync("git", args, { cwd: dir })
    git("init", "--quiet")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
    writeFileSync(join(dir, "b.ts"), "export const b = 1\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "seed")
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("names a tracked edit and an untracked file, and nothing that did not change", async () => {
    const dir = repo()
    writeFileSync(join(dir, "b.ts"), "export const b = 2\n")
    writeFileSync(join(dir, "c.ts"), "export const c = 3\n")

    const changed = await run(changedSince({ root: dir, revision: "HEAD" }))
    expect([...(changed ?? [])].sort((left, right) => left.localeCompare(right))).toEqual([
      "b.ts",
      "c.ts",
    ])
  })

  it("refuses a revision git cannot resolve instead of degrading to the whole tree", async () => {
    const dir = repo()
    expect(await run(changedSince({ root: dir, revision: "no-such-ref" }))).toBeUndefined()
  })
})
