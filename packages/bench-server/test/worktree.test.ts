import { expect, test } from "vitest"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Worktree, WorktreeLive } from "../src/Worktree.ts"

const run = promisify(execFile)

const project = async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-worktree-"))
  const repo = join(root, "repo")
  await run("git", ["init", "-q", "-b", "main", repo])
  await writeFile(join(repo, "README.md"), "bench\n")
  await run("git", ["-C", repo, "add", "README.md"])
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.email=bench@example.com",
    "-c",
    "user.name=Bench",
    "commit",
    "-qm",
    "init",
  ])
  return { root, repo, worktree: join(root, "bench") }
}

test("the worktree provider creates a checkout and archives it without deleting", async () => {
  const { root, repo, worktree } = await project()
  try {
    const ensured = await Effect.runPromise(
      Effect.gen(function* () {
        const trees = yield* Worktree
        return yield* trees.ensure({ root: worktree, repo, base: "main" })
      }).pipe(Effect.provide(WorktreeLive)),
    )
    expect(ensured).toBe(worktree)
    expect(await readFile(join(worktree, "README.md"), "utf8")).toBe("bench\n")

    await Effect.runPromise(
      Effect.gen(function* () {
        const trees = yield* Worktree
        yield* trees.archive({ root: worktree })
      }).pipe(Effect.provide(WorktreeLive)),
    )
    // The archive is a move, not a delete: the cold copy still has the file.
    const cold = join(root, "cold")
    const [name] = await import("node:fs/promises").then((fs) => fs.readdir(cold))
    expect(await readFile(join(cold, name!, "README.md"), "utf8")).toBe("bench\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
