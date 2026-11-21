import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const run = (args: ReadonlyArray<string>, cwd: string) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

test("one shop owner, and a queue from the room files", () => {
  const root = mkdtempSync(join(tmpdir(), "board-cli-"))
  try {
    const rooms = join(root, "rooms")
    mkdirSync(join(rooms, "r1"), { recursive: true })
    writeFileSync(
      join(rooms, "r1", "room.json"),
      JSON.stringify({
        id: "r1",
        base: "main",
        state: { _tag: "Paused", repo: "/r", scope: "dev", createdAt: 1, pausedAt: 2 },
      }),
    )
    expect(run(["status", "--root", "rooms"], root).stdout).toContain("r1 Paused")
    expect(run(["queue", "--root", "rooms"], root).stdout).toContain("r1")
    writeFileSync(join(rooms, "shop.lock"), JSON.stringify({ pid: process.pid }))
    expect(run(["up", "--root", "rooms"], root).status).toBe(1)
    expect(run(["down", "--root", "rooms"], root).status).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
