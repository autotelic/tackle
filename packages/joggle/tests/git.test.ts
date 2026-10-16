import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { layer as gitLayer, Service as Git } from "../src/git.ts"

/**
 * A throwaway repository with one commit on `main`.
 *
 * Git setup goes through the node builtin rather than the adapter under test:
 * the fixture is not what is being asserted, and a bug in `command` would
 * otherwise show up as a broken fixture.
 */
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-git-"))
  const git = (...args: ReadonlyArray<string>): void => {
    execFileSync("git", [...args], { cwd: dir, stdio: "pipe" })
  }
  git("init", "-q", "-b", "main")
  git("config", "user.email", "joggle@test")
  git("config", "user.name", "joggle")
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1\n")
  git("add", "-A")
  git("commit", "-qm", "base")
  return dir
}

const changedFiles = (cwd: string, options: { since?: string; pr?: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git
      return yield* git.changedFiles(cwd, options)
    }).pipe(Effect.provide(gitLayer), Effect.provide(NodeServices.layer)),
  )

test("a git scope is the branch diff plus uncommitted work", async () => {
  const dir = repo()
  const git = (...args: ReadonlyArray<string>): void => {
    execFileSync("git", [...args], { cwd: dir, stdio: "pipe" })
  }
  git("checkout", "-qb", "feature")
  // Committed on the branch.
  writeFileSync(join(dir, "src/b.ts"), "export const b = 1\n")
  git("add", "-A")
  git("commit", "-qm", "b")
  // Uncommitted, and untracked: the second pass of an iteration.
  writeFileSync(join(dir, "src/a.ts"), "export const a = 2\n")
  writeFileSync(join(dir, "src/c.ts"), "export const c = 1\n")

  expect(await changedFiles(dir, { since: "main" })).toEqual({
    changed: ["src/a.ts", "src/b.ts", "src/c.ts"],
    renamed: [],
  })
})

test("a pure rename is a move, not a content change", async () => {
  const dir = repo()
  const git = (...args: ReadonlyArray<string>): void => {
    execFileSync("git", [...args], { cwd: dir, stdio: "pipe" })
  }
  git("checkout", "-qb", "feature")
  // `git mv` with no edit: the bytes are identical, only the path moved.
  mkdirSync(join(dir, "src/domain"))
  git("mv", "src/a.ts", "src/domain/a.ts")
  git("commit", "-qm", "move a")
  // A rename that also edits content is a change, not a move.
  writeFileSync(join(dir, "src/b.ts"), "export const b = 1\n")
  git("add", "-A")
  git("commit", "-qm", "add b")
  writeFileSync(join(dir, "src/b.ts"), "export const b = 2\n")

  const scope = await changedFiles(dir, { since: "main" })
  expect(scope.renamed).toEqual(["src/domain/a.ts"])
  expect(scope.changed).toEqual(["src/b.ts"])
})

test("a branch with no changes yields no files", async () => {
  const dir = repo()
  expect(await changedFiles(dir, { since: "main" })).toEqual({ changed: [], renamed: [] })
})

test("a revision that does not exist is a typed failure, not a crash", async () => {
  const dir = repo()
  const failure = await Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git
      return yield* git.changedFiles(dir, { since: "no-such-ref" }).pipe(Effect.flip)
    }).pipe(Effect.provide(gitLayer), Effect.provide(NodeServices.layer)),
  )
  expect(failure._tag).toBe("joggle/GitError")
  expect(failure.operation).toContain("git")
})
