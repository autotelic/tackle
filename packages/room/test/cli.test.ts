import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/* oxlint-disable plumb/prefer-property-tests -- the subject is the printed sentence over one scratch repository. */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

const git = (cwd: string, ...args: ReadonlyArray<string>): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

/** A committed repository so `git worktree add` has a base to branch from. */
const repository = (root: string): string => {
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "room@example.test")
  git(repo, "config", "user.name", "Room Test")
  writeFileSync(join(repo, "README.md"), "room\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  return repo
}

const room = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
  })

const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "room-cli-"))
  return { root, close: () => rmSync(root, { recursive: true, force: true }) }
}

describe("a verb that prints a completion is a claim", () => {
  it("says pause recorded state and signalled nothing", () => {
    const { root, close } = scratch()
    try {
      const created = room(root, "new", "--repo", repository(root), "--scope", "dev")
      expect(created.status).toBe(0)
      const paused = room(root, "pause", "--id", "dev-repo")
      expect(paused.status).toBe(0)
      expect(paused.stdout).toBe("room dev-repo recorded paused; no process was signalled\n")
    } finally {
      close()
    }
  })

  it("says resume recorded state and started nothing", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      expect(room(root, "pause", "--id", "dev-repo").status).toBe(0)
      const resumed = room(root, "resume", "--id", "dev-repo")
      expect(resumed.status).toBe(0)
      expect(resumed.stdout).toBe("room dev-repo recorded ready; no process was started\n")
    } finally {
      close()
    }
  })

  it("refuses move instead of recording a move that does not happen", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const moved = room(root, "move", "--id", "dev-repo", "--to", "mini")
      expect(moved.status).toBe(1)
      expect(moved.stdout).toBe("")
      expect(moved.stderr).toContain(
        "move is not implemented; refusing to record a move that does not happen",
      )
    } finally {
      close()
    }
  })
})
