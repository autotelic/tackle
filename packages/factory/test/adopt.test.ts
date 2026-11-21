import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { adopt } from "../src/adopt.ts"
import { listWorkstreams } from "../src/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- fixed scratch repositories and one fake gh. */

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

const repository = (root: string): string => {
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  git(repo, "remote", "add", "origin", "https://github.com/acme/app.git")
  return repo
}

const fakeGh = (root: string): string => {
  const path = join(root, "gh")
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "head=$(git rev-parse HEAD)",
      "branch=$(git rev-parse --abbrev-ref HEAD)",
      "pr=$3",
      'printf \'{"number":%s,"headRefName":"%s","headRefOid":"%s","baseRefName":"main","baseRefOid":"%s","url":"https://github.com/acme/app/pull/%s"}\' "$pr" "$branch" "$head" "$(git rev-parse main)" "$pr"',
      "",
    ].join("\n"),
  )
  chmodSync(path, 0o755)
  return path
}

type Overrides = { readonly id?: string; readonly phase?: "reconcile" | "build" | "land" }

const adoptInput = (root: string, path: string, overrides: Overrides = {}) => ({
  path,
  project: "P-AUT-128",
  label: "permissions-overhaul",
  pr: 1862,
  id: "permissions-1862",
  phase: "reconcile" as const,
  at: "2026-11-21T00:00:00.000Z",
  home: join(root, "home"),
  ...overrides,
})

test("adopts an existing worktree in place and checkpoints dirty work", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"))
  try {
    process.env.GH_BIN = fakeGh(root)
    const repo = repository(root)
    writeFileSync(join(repo, "WIP.md"), "uncommitted\n")

    const result = await adopt(adoptInput(root, repo))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.path).toBe(realpathSync(repo))
    expect(result.value.branch).toBe("main")
    expect(result.value.checkpoint.sha).not.toBe(result.value.head)
    expect(existsSync(join(root, "home", "workstreams", "permissions-1862.json"))).toBe(true)
    expect(
      execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }),
    ).toContain("WIP.md")
    expect(
      execFileSync("git", ["-C", repo, "show", result.value.checkpoint.ref + ":WIP.md"], {
        encoding: "utf8",
      }),
    ).toBe("uncommitted\n")
    expect((await listWorkstreams({ home: join(root, "home") }))[0]?.id).toBe("permissions-1862")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("refuses the same path twice and names the owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"))
  try {
    process.env.GH_BIN = fakeGh(root)
    const repo = repository(root)
    expect((await adopt(adoptInput(root, repo))).ok).toBe(true)
    const again = await adopt(adoptInput(root, repo, { id: "other" }))
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.step).toBe("collision")
      expect(again.error.detail).toContain("permissions-1862")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("refuses a second workstream for the same PR", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"))
  try {
    process.env.GH_BIN = fakeGh(root)
    const repo = repository(root)
    expect((await adopt(adoptInput(root, repo))).ok).toBe(true)
    const second = join(root, "repo-2")
    git(repo, "worktree", "add", "-b", "feature/other", second, "HEAD")
    const again = await adopt(adoptInput(root, second, { id: "other" }))
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.detail).toContain("permissions-1862")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("the record lives outside the governed repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-"))
  try {
    process.env.GH_BIN = fakeGh(root)
    const repo = repository(root)
    const result = await adopt(adoptInput(root, repo))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.path.startsWith(join(root, "home"))).toBe(false)
    expect(
      readFileSync(join(root, "home", "workstreams", "permissions-1862.json"), "utf8"),
    ).toContain('"project": "P-AUT-128"')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
