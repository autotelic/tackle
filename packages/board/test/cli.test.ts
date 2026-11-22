import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { recordOf } from "@autotelic/factory/store"
import { expect, test } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const run = (args: ReadonlyArray<string>, cwd: string) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

test("presence is readable without a shop", () => {
  const root = mkdtempSync(join(tmpdir(), "board-presence-"))
  try {
    const output = run(["presence", "--json", "--root", "rooms"], root)
    expect(output.status).toBe(0)
    const presence = JSON.parse(output.stdout)
    expect(presence).toMatchObject({ shop: "rooms", rooms: [] })
    expect(Array.isArray(presence.sessions.herdr.sessions)).toBe(true)
    expect(Array.isArray(presence.sessions.rex.sessions)).toBe(true)
    expect(presence.sessions.herdr).toHaveProperty("available")
    expect(presence.sessions.rex).toHaveProperty("available")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
    expect(held.shop).toEqual({
      state: "held",
      pid: process.pid,
      since: 5,
      port: undefined,
      host: undefined,
      alive: true,
    })
    expect(held.rooms).toHaveLength(1)

    writeFileSync(join(rooms, "shop.lock"), JSON.stringify({ pid: 99999999 }))
    expect(run(["status", "--root", "rooms"], root).stdout).toContain(
      "shop: stale lock from 99999999",
    )

    writeFileSync(join(rooms, "shop.lock"), "{")
    expect(run(["status", "--root", "rooms"], root).stdout).toContain("shop: lock unreadable")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)

test("board up serves presence and queue until down", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-up-"))
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
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    const up = run(["up", "--root", "rooms", "--port", String(port), "--detach"], root)
    expect(up.status, up.stderr).toBe(0)
    expect(up.stdout).toContain("listening on http://127.0.0.1:" + port)

    const health = await fetch("http://127.0.0.1:" + port + "/health")
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, shop: "rooms" })

    const presence = await fetch("http://127.0.0.1:" + port + "/presence")
    expect(presence.status).toBe(200)
    expect(await presence.json()).toMatchObject({
      shop: "rooms",
      rooms: [{ id: "r1", state: "Paused" }],
      service: { port },
    })

    const discovery = await fetch("http://127.0.0.1:" + port + "/.well-known/presence.json")
    expect(discovery.status).toBe(200)
    expect(await discovery.json()).toMatchObject({ shop: "rooms" })

    const queue = await fetch("http://127.0.0.1:" + port + "/queue")
    expect(await queue.json()).toEqual(["r1"])

    expect(run(["status", "--root", "rooms"], root).stdout).toContain("shop: lock held by ")
    const down = run(["down", "--root", "rooms"], root)
    expect(down.status).toBe(0)
    expect(down.stdout).toContain("stopped")
    expect(run(["status", "--root", "rooms"], root).stdout).toContain("shop: no lock")
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("presence carries the timeline the view's strip draws", () => {
  const root = mkdtempSync(join(tmpdir(), "board-timeline-"))
  try {
    const home = join(root, "factory")
    const workstreams = join(home, "workstreams")
    const at = new Date(Date.now() - 10 * 60_000).toISOString()
    const endedAt = new Date(Date.now() - 9 * 60_000).toISOString()
    mkdirSync(join(workstreams, "tackle-5.receipts"), { recursive: true })
    writeFileSync(
      join(workstreams, "tackle-5.receipts", "0001.json"),
      JSON.stringify({
        workstream: "tackle-5",
        pass: 1,
        at,
        endedAt,
        status: "done",
        phase: "build",
        events: ["report:one"],
        checkpoint: "abc12345",
        exit: 0,
      }),
    )
    writeFileSync(
      join(workstreams, "tackle-5.json"),
      JSON.stringify(
        recordOf({
          id: "tackle-5",
          facts: {
            project: "factory-view",
            label: "tackle-5",
            repo: "autotelic/tackle",
            path: "/tmp/tackle-5",
            branch: "loop/5",
            head: "abc12345",
            delivery: "trunk",
            pr: undefined,
            base: "main",
            baseSha: "abc12345",
            prHead: "abc12345",
            phase: "build",
            at,
            checkpoint: {
              sha: "abc12345",
              ref: "refs/bench/tackle-5",
              at: endedAt,
              pushed: false,
            },
          },
        }),
      ),
    )
    const output = spawnSync(
      process.execPath,
      ["--conditions=development", cli, "presence", "--json", "--root", join(root, "rooms")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          FACTORY_HOME: home,
          HERDR_BIN: "/bin/false",
          REX_BIN: "/bin/false",
        },
      },
    )
    expect(output.status, output.stderr).toBe(0)
    const presence = JSON.parse(output.stdout)
    const activity = presence.factory.activity.find(
      (entry: { readonly workstream: string }) => entry.workstream === "tackle-5",
    )
    expect(activity.timeline.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pass",
          pass: 1,
          status: "done",
          endedAt,
          sha: "abc12345",
        }),
        expect.objectContaining({ kind: "checkpoint", at: endedAt, sha: "abc12345" }),
      ]),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test("restarts a room supervisor that died", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-watch-"))
  const rooms = join(root, "rooms")
  try {
    mkdirSync(join(rooms, "r1", "worktree"), { recursive: true })
    writeFileSync(
      join(rooms, "r1", "room.json"),
      JSON.stringify({
        id: "r1",
        base: "main",
        state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
      }),
    )
    writeFileSync(
      join(rooms, "r1", "run.json"),
      JSON.stringify({ pid: 99999999, exec: "sleep 30", startedAt: 1, log: "room.log" }),
    )
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    expect(run(["up", "--root", "rooms", "--port", String(port), "--detach"], root).status).toBe(0)
    let pid = 99999999
    const record = join(rooms, "r1", "run.json")
    for (let attempt = 0; attempt < 60; attempt++) {
      if (existsSync(record)) pid = JSON.parse(readFileSync(record, "utf8")).pid
      if (pid !== 99999999) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(pid).not.toBe(99999999)
    expect(() => process.kill(pid, 0)).not.toThrow()
    expect(run(["down", "--root", "rooms"], root).status).toBe(0)
    process.kill(-pid, "SIGTERM")
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("starts a room that is wanted but has no run record", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-want-"))
  const rooms = join(root, "rooms")
  try {
    mkdirSync(join(rooms, "r2", "worktree"), { recursive: true })
    writeFileSync(
      join(rooms, "r2", "room.json"),
      JSON.stringify({
        id: "r2",
        base: "main",
        state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
        exec: "sleep 30",
        desired: true,
      }),
    )
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    expect(run(["up", "--root", "rooms", "--port", String(port), "--detach"], root).status).toBe(0)
    const record = join(rooms, "r2", "run.json")
    let pid = 0
    for (let attempt = 0; attempt < 60; attempt++) {
      if (existsSync(record)) pid = JSON.parse(readFileSync(record, "utf8")).pid
      if (pid !== 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).not.toThrow()
    expect(run(["down", "--root", "rooms"], root).status).toBe(0)
    process.kill(-pid, "SIGTERM")
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
