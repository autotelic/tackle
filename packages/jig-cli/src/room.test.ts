import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/* oxlint-disable plumb/prefer-property-tests -- the subject is the sentence that crosses one scratch door. */

const jig = fileURLToPath(new URL("./cli.ts", import.meta.url))
const room = fileURLToPath(new URL("../../room/src/cli.ts", import.meta.url))

const git = (cwd: string, ...args: ReadonlyArray<string>): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

const run = (cwd: string, args: ReadonlyArray<string>, path?: string) =>
  spawnSync(process.execPath, ["--conditions=development", jig, ...args], {
    cwd,
    encoding: "utf8",
    env: path === undefined ? process.env : { ...process.env, PATH: path },
  })

const scratch = () => mkdtempSync(join(tmpdir(), "jig-room-"))

/**
 * A project-local room that runs the source under test. The door must pick this over PATH,
 * and spawning jig with a pipe is what lets the inherited room output be asserted; calling
 * runRoom inside the test would inherit the runner's own pipe and see nothing.
 */
const projectWithRoom = (): string => {
  const root = scratch()
  git(root, "init", "-q", "-b", "main")
  git(root, "config", "user.email", "jig@example.test")
  git(root, "config", "user.name", "Jig Test")
  writeFileSync(join(root, "README.md"), "room\n")
  git(root, "add", "README.md")
  git(root, "commit", "-q", "-m", "init")
  const bin = join(root, "node_modules", ".bin")
  mkdirSync(bin, { recursive: true })
  const wrapper = join(bin, "room")
  writeFileSync(
    wrapper,
    '#!/bin/sh\nexec "' + process.execPath + '" --conditions=development "' + room + '" "$@"\n',
  )
  chmodSync(wrapper, 0o755)
  return root
}

describe("jig room is a door, not a second renderer", () => {
  it("hands back the room's own sentence", () => {
    const root = projectWithRoom()
    try {
      const created = run(root, [
        "room",
        "new",
        "--repo",
        ".",
        "--scope",
        "dev",
        "--id",
        "dev-repo",
      ])
      expect(created.status).toBe(0)
      const paused = run(root, ["room", "pause", "--id", "dev-repo"])
      expect(paused.status).toBe(0)
      expect(paused.stdout).toContain("journal ")
      expect(paused.stdout).toContain("checkpointed; no process was signalled")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  it("uses the project's room before a stale one on PATH", () => {
    const root = projectWithRoom()
    const stale = scratch()
    try {
      const staleBin = join(stale, "room")
      writeFileSync(staleBin, "#!/bin/sh\necho stale-room\nexit 9\n")
      chmodSync(staleBin, 0o755)
      const status = run(root, ["room", "status"], stale + ":" + (process.env.PATH ?? ""))
      expect(status.stdout).not.toContain("stale-room")
      expect(status.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(stale, { recursive: true, force: true })
    }
  }, 20_000)

  it("reports a non-executable project bin as infrastructure", () => {
    const root = projectWithRoom()
    try {
      chmodSync(join(root, "node_modules", ".bin", "room"), 0o644)
      const status = run(root, ["room", "status"])
      expect(status.status).toBe(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
