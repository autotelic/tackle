import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

/*
 * The room front door in Herdr.
 *
 * Each case runs the real board process with fake `hc` and `herdr-app` on the environment, so
 * the route is exercised through the same argv it would hand the real binaries. The log those
 * fakes append to is the assertion: which terminal was focused, or what `hc run` was asked to
 * start, and nothing invented in between.
 */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

const executable = (path: string, body: string) => {
  writeFileSync(path, "#!/bin/sh\n" + body)
  chmodSync(path, 0o755)
}

const fakeBinaries = (root: string): { readonly bin: string; readonly log: string } => {
  const bin = join(root, "bin")
  const log = join(root, "calls.log")
  mkdirSync(bin, { recursive: true })
  executable(
    join(bin, "hc"),
    [
      'printf "hc %s\\n" "$*" >> "$FAKE_LOG"',
      'case "$1" in',
      '  ls) cat "$FAKE_LS" ;;',
      '  get) cat "$FAKE_GET" ;;',
      "  run)",
      '    if [ -n "$FAKE_RUN_FAIL" ]; then',
      '      echo "hc: the core is not running" >&2',
      "      exit 7",
      "    fi",
      '    printf \'{"address":"t99"}\\n\'',
      "    ;;",
      "esac",
    ].join("\n"),
  )
  executable(join(bin, "herdr-app"), 'printf "herdr-app %s\\n" "$*" >> "$FAKE_LOG"\nexit 0')
  return { bin, log }
}

const room = (root: string, id: string) => {
  const dir = join(root, "rooms", id)
  mkdirSync(join(dir, "worktree"), { recursive: true })
  writeFileSync(
    join(dir, "room.json"),
    JSON.stringify({
      id,
      base: "main",
      state: { _tag: "Paused", repo: "/repo", scope: "dev", createdAt: 1 },
    }),
  )
  return join(dir, "worktree")
}

const health = async (port: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const answer = await fetch("http://127.0.0.1:" + port + "/health").catch(() => undefined)
    if (answer?.ok === true) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

const serve = async (input: {
  readonly root: string
  readonly port: number
  readonly env: Readonly<Record<string, string>>
}) => {
  const up = spawnSync(
    process.execPath,
    [
      "--conditions=development",
      cli,
      "up",
      "--root",
      "rooms",
      "--port",
      String(input.port),
      "--detach",
    ],
    { cwd: input.root, encoding: "utf8", env: { ...process.env, ...input.env } },
  )
  expect(up.status, up.stderr).toBe(0)
  expect(await health(input.port)).toBe(true)
}

const down = (root: string) =>
  spawnSync(process.execPath, ["--conditions=development", cli, "down", "--root", "rooms"], {
    cwd: root,
    encoding: "utf8",
  })

const port = (): number => 20_000 + Math.floor(Math.random() * 20_000)

test("opens the terminal that already carries the room label", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-open-label-"))
  try {
    room(root, "r1")
    const { bin, log } = fakeBinaries(root)
    writeFileSync(
      join(root, "ls.json"),
      JSON.stringify({ terminals: [{ address: "t18", cwd: "/elsewhere", state: "live" }] }),
    )
    writeFileSync(join(root, "get.json"), JSON.stringify({ labels: { room: "r1" } }))
    const listener = port()
    await serve({
      root,
      port: listener,
      env: {
        HERDR_BIN: join(bin, "hc"),
        HERDR_APP_BIN: join(bin, "herdr-app"),
        FAKE_LOG: log,
        FAKE_LS: join(root, "ls.json"),
        FAKE_GET: join(root, "get.json"),
      },
    })
    const answer = await fetch("http://127.0.0.1:" + listener + "/rooms/r1/open", {
      method: "POST",
    })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, id: "r1", rung: "herdr-app", address: "t18" })
    const calls = readFileSync(log, "utf8")
    expect(calls).toContain("herdr-app do agent.focus --terminal t18")
    expect(calls).not.toContain("hc run")
  } finally {
    down(root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("starts the shell in the room worktree with the label at spawn, then focuses it", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-open-start-"))
  try {
    const worktree = room(root, "r1")
    const { bin, log } = fakeBinaries(root)
    writeFileSync(join(root, "ls.json"), JSON.stringify({ terminals: [] }))
    writeFileSync(join(root, "get.json"), JSON.stringify({ labels: {} }))
    const listener = port()
    await serve({
      root,
      port: listener,
      env: {
        HERDR_BIN: join(bin, "hc"),
        HERDR_APP_BIN: join(bin, "herdr-app"),
        FAKE_LOG: log,
        FAKE_LS: join(root, "ls.json"),
        FAKE_GET: join(root, "get.json"),
      },
    })
    const answer = await fetch("http://127.0.0.1:" + listener + "/rooms/r1/open", {
      method: "POST",
    })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, id: "r1", rung: "herdr-app", address: "t99" })
    const calls = readFileSync(log, "utf8")
    // No argv after the flags: `hc run` starts the user's own shell.
    expect(calls).toContain(
      "hc run --bg --json --name room-r1 --label room=r1 --cwd " + worktree + " --no-parent",
    )
    expect(calls).toContain("herdr-app do agent.focus --terminal t99")
  } finally {
    down(root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("reports a failed start instead of opening another room's terminal", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-open-fail-"))
  try {
    room(root, "r1")
    const { bin, log } = fakeBinaries(root)
    // r2 is live and labeled; r1 is the room the request names and it has no terminal.
    writeFileSync(
      join(root, "ls.json"),
      JSON.stringify({ terminals: [{ address: "t20", cwd: "/repo/r2", state: "live" }] }),
    )
    writeFileSync(join(root, "get.json"), JSON.stringify({ labels: { room: "r2" } }))
    const listener = port()
    await serve({
      root,
      port: listener,
      env: {
        HERDR_BIN: join(bin, "hc"),
        HERDR_APP_BIN: join(bin, "herdr-app"),
        FAKE_LOG: log,
        FAKE_LS: join(root, "ls.json"),
        FAKE_GET: join(root, "get.json"),
        FAKE_RUN_FAIL: "1",
      },
    })
    const answer = await fetch("http://127.0.0.1:" + listener + "/rooms/r1/open", {
      method: "POST",
    })
    expect(answer.status).toBe(502)
    const body = await answer.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toContain("hc run failed")
    const calls = readFileSync(log, "utf8")
    expect(calls).not.toContain("agent.focus")
  } finally {
    down(root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("refuses a room that does not exist before it looks for a terminal", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-open-missing-"))
  try {
    room(root, "r2")
    const { bin, log } = fakeBinaries(root)
    writeFileSync(
      join(root, "ls.json"),
      JSON.stringify({ terminals: [{ address: "t20", cwd: "/repo/r2", state: "live" }] }),
    )
    writeFileSync(join(root, "get.json"), JSON.stringify({ labels: { room: "r2" } }))
    const listener = port()
    await serve({
      root,
      port: listener,
      env: {
        HERDR_BIN: join(bin, "hc"),
        HERDR_APP_BIN: join(bin, "herdr-app"),
        FAKE_LOG: log,
        FAKE_LS: join(root, "ls.json"),
        FAKE_GET: join(root, "get.json"),
      },
    })
    const answer = await fetch("http://127.0.0.1:" + listener + "/rooms/r1/open", {
      method: "POST",
    })
    expect(answer.status).toBe(404)
    expect(await answer.json()).toMatchObject({ ok: false, reason: "RoomNotFound: r1" })
    expect(readFileSync(log, "utf8")).not.toContain("agent.focus")
  } finally {
    down(root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
