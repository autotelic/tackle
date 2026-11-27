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
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { roomSessionPath } from "@autotelic/room/RoomSession"
import { createRoom, readRoom, roomDir, roomWorktree } from "@autotelic/room/store"
import { adopt, type AdoptInput } from "../src/factory/adopt.ts"
import { appendEvent, readEvents } from "../src/factory/events.ts"
import { runPass } from "../src/factory/kernel.ts"
import { readWorkstream, workstreamFile } from "../src/factory/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- one fixed scratch repository and one real room. */

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * A repository, and a room whose worktree is a real checkout of it.
 *
 * The origin is removed so the checkpoint's push fails immediately instead of reaching
 * github.com; delivery is trunk, so adoption never needs a fake `gh`.
 */
const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-room-"))
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")

  const roomRoot = join(root, "rooms")
  const roomId = "permissions-1862"
  const worktree = roomWorktree({ root: roomRoot, id: roomId })
  mkdirSync(join(roomRoot, roomId), { recursive: true })
  git(repo, "worktree", "add", "-b", "room/" + roomId + "-main", worktree, "HEAD")
  const room = await createRoom({
    root: roomRoot,
    id: roomId,
    repo,
    scope: "permissions-overhaul",
    base: "main",
    at: Date.parse("2026-11-21T00:00:00.000Z"),
  })
  expect(room.ok).toBe(true)
  return { root, repo, roomRoot, roomId, worktree, home: join(root, "home") }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

const adopted = (f: Fixture, overrides: Partial<AdoptInput> = {}) =>
  adopt({
    path: f.worktree,
    project: "P-AUT-128",
    label: "permissions-overhaul",
    delivery: "trunk",
    pr: undefined,
    id: f.roomId,
    phase: "build",
    at: "2026-11-21T00:00:00.000Z",
    room: { id: f.roomId, root: f.roomRoot },
    home: f.home,
    ...overrides,
  })

const taskEvent = (f: Fixture) =>
  appendEvent({
    id: f.roomId,
    home: f.home,
    event: {
      id: "ticket-1",
      kind: "task",
      at: "2026-11-21T00:01:00.000Z",
      payload: { task: "bind the room" },
      status: "pending",
    },
  })

test("adopt binds the room whose worktree is the adopted checkout", async () => {
  const f = await fixture()
  try {
    const result = await adopted(f)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.room).toEqual({ id: f.roomId, root: resolve(f.roomRoot) })
    expect(result.value.path).toBe(realpathSync(f.worktree))
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("adopt refuses a room whose worktree is another checkout, naming both", async () => {
  const f = await fixture()
  try {
    const result = await adopted(f, { path: f.repo })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.step).toBe("room")
    expect(result.error.detail).toContain("RoomMismatch")
    expect(result.error.detail).toContain(roomWorktree({ root: f.roomRoot, id: f.roomId }))
    expect(result.error.detail).toContain(realpathSync(f.repo))
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("adopt refuses a room that does not exist", async () => {
  const f = await fixture()
  try {
    const result = await adopted(f, { room: { id: "absent", root: f.roomRoot } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.step).toBe("room")
    expect(result.error.detail).toContain("RoomMissing: no room absent")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a record written before the binding decodes unchanged", async () => {
  const f = await fixture()
  try {
    const bound = await adopted(f)
    expect(bound.ok).toBe(true)
    const file = workstreamFile({ id: f.roomId, home: f.home })
    const written = JSON.parse(readFileSync(file, "utf8")) as { room?: unknown }
    delete written.room
    writeFileSync(file, JSON.stringify(written, null, 2) + "\n")

    const record = await readWorkstream({ id: f.roomId, home: f.home })
    expect(record?.room).toBeUndefined()
    expect(record?.path).toBe(realpathSync(f.worktree))
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a bound pass runs in the room's worktree with the room's journal", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const worker = join(f.root, "worker.sh")
    writeFileSync(
      worker,
      [
        "#!/bin/sh",
        'printf "%s" "$PWD" > "$ROOM_CWD_WITNESS"',
        'printf "%s\\n%s\\n%s" "$TACKLE_ROOM_ROOT" "$TACKLE_ROOM_ID" "$TACKLE_ROOM_SESSION" > "$ROOM_ENV_WITNESS"',
        "",
      ].join("\n"),
    )
    chmodSync(worker, 0o755)
    const cwdWitness = join(f.root, "cwd.txt")
    const envWitness = join(f.root, "env.txt")
    process.env.ROOM_CWD_WITNESS = cwdWitness
    process.env.ROOM_ENV_WITNESS = envWitness

    const result = await runPass({
      id: f.roomId,
      worker,
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)

    expect(realpathSync(readFileSync(cwdWitness, "utf8"))).toBe(realpathSync(f.worktree))
    const [root, id, session] = readFileSync(envWitness, "utf8").split("\n")
    expect(root).toBe(resolve(f.roomRoot))
    expect(id).toBe(f.roomId)
    // The journal the room created, not a path the worker or the kernel derived for itself.
    const roomFile = await readRoom({ root: f.roomRoot, id: f.roomId })
    expect(session).toBe(
      roomSessionPath({
        dir: roomDir({ root: f.roomRoot, id: f.roomId }),
        session: roomFile?.session,
      }),
    )
    expect(session).toBeDefined()
    if (session === undefined) return
    expect(existsSync(session)).toBe(true)
  } finally {
    delete process.env.ROOM_CWD_WITNESS
    delete process.env.ROOM_ENV_WITNESS
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a room that disappeared refuses the pass instead of falling back to the record", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    rmSync(join(roomDir({ root: f.roomRoot, id: f.roomId }), "room.json"))

    const result = await runPass({
      id: f.roomId,
      worker: "true",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("RoomMissing")
    // The refusal costs nothing: the event is still work for the pass that fixes the room.
    expect((await readEvents({ id: f.roomId, home: f.home }))[0]?.status).toBe("pending")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)
