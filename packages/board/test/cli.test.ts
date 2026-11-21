import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const run = (args: ReadonlyArray<string>, cwd: string) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

test("status reports the lock it claims to own", () => {
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
    expect(run(["status", "--root", "rooms"], root).stdout).toContain("shop: no lock")
    expect(run(["queue", "--root", "rooms"], root).stdout).toContain("r1")

    writeFileSync(join(rooms, "shop.lock"), JSON.stringify({ pid: process.pid, at: 5 }))
    expect(run(["status", "--root", "rooms"], root).stdout).toContain(
      "shop: lock held by " + process.pid,
    )
    const held = JSON.parse(run(["status", "--root", "rooms", "--json"], root).stdout)
    expect(held.shop).toEqual({ state: "held", pid: process.pid, since: 5, alive: true })
    expect(held.rooms).toHaveLength(1)

    writeFileSync(join(rooms, "shop.lock"), JSON.stringify({ pid: 99999999 }))
    expect(run(["status", "--root", "rooms"], root).stdout).toContain(
      "shop: stale lock from 99999999",
    )

    writeFileSync(join(rooms, "shop.lock"), "{")
    expect(run(["status", "--root", "rooms"], root).stdout).toContain("shop: lock unreadable")

    const up = run(["up", "--root", "rooms"], root)
    expect(up.status).toBe(1)
    expect(up.stderr).toContain("not a supervisor yet")
    expect(run(["down", "--root", "rooms"], root).status).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
