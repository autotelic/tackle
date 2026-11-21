import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const run = (args: ReadonlyArray<string>, cwd: string) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

const repo = (root: string): string => {
  const path = join(root, "repo")
  execFileSync("git", ["init", "-q", "-b", "main", path])
  writeFileSync(join(path, "README.md"), "room\n")
  execFileSync("git", ["-C", path, "add", "README.md"])
  execFileSync("git", [
    "-C",
    path,
    "-c",
    "user.email=a@b.c",
    "-c",
    "user.name=A",
    "commit",
    "-qm",
    "init",
  ])
  return path
}

test("new, status, pause, resume and move through the room binary", () => {
  const root = mkdtempSync(join(tmpdir(), "room-cli-"))
  try {
    const path = repo(root)
    const created = run(
      ["new", "--repo", path, "--scope", "dev", "--id", "r1", "--root", "rooms"],
      root,
    )
    expect(created.status).toBe(0)
    expect(readFileSync(join(root, "rooms", "r1", "room.json"), "utf8")).toContain('"Ready"')
    expect(run(["status", "--id", "r1", "--root", "rooms"], root).stdout).toContain("r1 Ready")
    expect(run(["pause", "--id", "r1", "--root", "rooms"], root).status).toBe(0)
    expect(run(["pause", "--id", "r1", "--root", "rooms"], root).status).toBe(1)
    expect(run(["resume", "--id", "r1", "--root", "rooms"], root).status).toBe(0)
    expect(run(["move", "--id", "r1", "--to", "mini", "--root", "rooms"], root).status).toBe(0)
    expect(readFileSync(join(root, "rooms", "r1", "move.json"), "utf8")).toContain("mini")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("usage and decode failures are not declined", () => {
  const root = mkdtempSync(join(tmpdir(), "room-cli-"))
  try {
    expect(run(["new", "--scope", "dev"], root).status).toBe(2)
    mkdirSync(join(root, "rooms", "bad"), { recursive: true })
    writeFileSync(join(root, "rooms", "bad", "room.json"), "not json")
    expect(run(["status", "--id", "bad", "--root", "rooms"], root).status).toBe(2)
    expect(run(["pause", "--root", "rooms"], root).status).toBe(2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
