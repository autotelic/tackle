/* oxlint-disable plumb/prefer-property-tests -- the claim is one branch pair per worktree; the fixture is the boundary. */
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { adopt } from "../src/adopt.ts"
import { branchGuard } from "../src/branch.ts"
import { appendEvent, readEvents } from "../src/events.ts"
import { passesUsed, runPass } from "../src/kernel.ts"

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

const ID = "tackle-factory"
const BRANCH = "factory/feature"

/** A throwaway repo adopted on its own branch, plus a second repo no record owns. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "factory-branch-"))
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  git(repo, "remote", "add", "origin", "https://github.com/autotelic/tackle.git")
  git(repo, "switch", "-q", "-c", BRANCH)
  return { root, repo, home: join(root, "home") }
}

type Fixture = ReturnType<typeof fixture>

const adoptIt = async (f: Fixture) => {
  const result = await adopt({
    path: f.repo,
    project: "factory",
    label: "factory-feedback",
    delivery: "trunk",
    pr: undefined,
    id: ID,
    phase: "build",
    at: "2026-11-22T00:00:00.000Z",
    home: f.home,
  })
  expect(result.ok).toBe(true)
}

const queueEvent = (f: Fixture) =>
  appendEvent({
    id: ID,
    home: f.home,
    event: {
      id: "desk-1",
      kind: "desk",
      at: "2026-11-22T00:01:00.000Z",
      payload: {},
      status: "pending",
    },
  })

/** The installed entry point's own words: exit status and stderr, not an imported function. */
const guard = (f: Fixture, cwd: string) =>
  spawnSync(
    process.execPath,
    ["--conditions=development", join(import.meta.dirname, "../src/cli.ts"), "guard"],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, FACTORY_HOME: f.home },
    },
  )

test("a pass on a worktree switched off the record's branch is refused, charged to nobody, and its event stays pending", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    await queueEvent(f)
    git(f.repo, "switch", "-q", "main")

    const result = await runPass({
      id: ID,
      worker: "exit 0",
      at: "2026-11-22T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("BranchMismatch: expected " + BRANCH + ", found main")
    expect(result.receipt).toBeUndefined()
    expect(await passesUsed({ id: ID, home: f.home })).toBe(0)
    expect((await readEvents({ id: ID, home: f.home }))[0]?.status).toBe("pending")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a pass on the record's own branch runs", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    await queueEvent(f)
    const worker = join(f.root, "worker.sh")
    writeFileSync(worker, "#!/bin/sh\necho handled > handled.txt\n")
    chmodSync(worker, 0o755)
    const verdict = await branchGuard({ path: f.repo, home: f.home })
    expect(verdict._tag).toBe("OnBranch")
    if (verdict._tag !== "OnBranch") return
    expect(verdict.branch).toBe(BRANCH)

    const result = await runPass({
      id: ID,
      worker,
      at: "2026-11-22T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.status).toBe("done")
    expect(await passesUsed({ id: ID, home: f.home })).toBe(1)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a detached HEAD is refused rather than read as its own kind of match", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    await queueEvent(f)
    git(f.repo, "switch", "-q", "--detach", "HEAD")

    const result = await runPass({
      id: ID,
      worker: "exit 0",
      at: "2026-11-22T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("BranchMismatch: expected " + BRANCH + ", found (no branch")
    expect(await passesUsed({ id: ID, home: f.home })).toBe(0)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("the guard exits 1 naming both branches when the worktree moved off the record's branch", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    git(f.repo, "switch", "-q", "main")

    const result = guard(f, f.repo)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("expected " + BRANCH)
    expect(result.stderr).toContain("found main")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("the guard exits 0 on a path no record owns, and on the record's own branch", async () => {
  const f = fixture()
  try {
    const other = join(f.root, "other")
    mkdirSync(other, { recursive: true })
    git(other, "init", "-q", "-b", "anything")
    expect(guard(f, other).status).toBe(0)

    await adoptIt(f)
    const own = guard(f, f.repo)
    expect(own.status).toBe(0)
    expect(own.stdout).toContain(ID + " is on its branch " + BRANCH)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)
