/* oxlint-disable plumb/prefer-property-tests -- one fixed scratch repository and one real room; the assertions are refusals and routing. */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { roomSessionPath } from "@autotelic/room/RoomSession"
import { createRoom, readRoom, roomDir, roomWorktree } from "@autotelic/room/store"
import { adopt, type AdoptInput } from "../src/factory/adopt.ts"
import { appendEvent, readEvents } from "../src/factory/events.ts"
import { runPass } from "../src/factory/kernel.ts"
import type {
  GuestRun,
  GuestRunInput,
  GuestStart,
  GuestStartInput,
  RoomGuest,
} from "../src/factory/room-vm.ts"
import { workstreamDir } from "../src/factory/store.ts"

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * A repository, and a room whose worktree is a real checkout of it.
 *
 * The origin is removed so the checkpoint's push fails immediately instead of reaching
 * github.com; delivery is trunk, so adoption never needs a fake `gh`.
 */
const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-room-vm-"))
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
      payload: { task: "run the pass in the room" },
      status: "pending",
    },
  })

/**
 * A guest that records what it was asked and answers with a fixed result.
 *
 * The kernel's whole claim is that a bound pass goes to the room's supervisor and nowhere else,
 * so the seam is what a test can hold: the boot it requested, the command and environment it
 * handed over, and what it did with the answer.
 */
const fakeGuest = (
  options: {
    readonly start?: GuestStart
    readonly run?: (input: GuestRunInput) => GuestRun
  } = {},
): RoomGuest & {
  readonly starts: Array<GuestStartInput>
  readonly runs: Array<GuestRunInput>
} => {
  const starts: Array<GuestStartInput> = []
  const runs: Array<GuestRunInput> = []
  return {
    starts,
    runs,
    start: async (input) => {
      starts.push(input)
      return options.start ?? { ok: true, socket: "/tmp/room-vm.sock", pid: 4242, started: true }
    },
    run: async (input) => {
      runs.push(input)
      return options.run?.(input) ?? { ok: true, status: 0, stdout: "", stderr: "" }
    },
  }
}

const receiptOf = (f: Fixture, pass: number) =>
  JSON.parse(
    readFileSync(
      join(workstreamDir(f.home), f.roomId + ".receipts", String(pass).padStart(4, "0") + ".json"),
      "utf8",
    ),
  ) as { status: string; exit: number | undefined; vm?: { room: string; started: boolean } }

test("a bound pass boots the room's VM and runs the worker in the guest", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest()
    // A command that would leave a file behind if a host shell had run it.
    const hostWitness = join(f.root, "host-only.txt")
    const worker = "printf host > " + hostWitness

    const result = await runPass({
      id: f.roomId,
      worker,
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(true)

    // The boot names the room and the checkout the guest mounts at /workspace.
    expect(guest.starts).toHaveLength(1)
    expect(guest.starts[0]?.room).toEqual({ id: f.roomId, root: resolve(f.roomRoot) })
    expect(guest.starts[0]?.worktree).toBe(f.worktree)

    // The command crossed the seam as one shell command with the room's own contract in it.
    const run = guest.runs[0]
    expect(run?.worker).toBe(worker)
    expect(run?.room.id).toBe(f.roomId)
    const room = await readRoom({ root: f.roomRoot, id: f.roomId })
    expect(run?.env.TACKLE_ROOM_ROOT).toBe(resolve(f.roomRoot))
    expect(run?.env.TACKLE_ROOM_ID).toBe(f.roomId)
    expect(run?.env.TACKLE_ROOM_SESSION).toBe(
      roomSessionPath({ dir: roomDir({ root: f.roomRoot, id: f.roomId }), session: room?.session }),
    )
    // The workstream's own label travels with the worker, not with a terminal it cannot see.
    expect(run?.env.FACTORY_WORKSTREAM).toBe(f.roomId)

    // Nothing ran on the host: the only process was the guest's.
    expect(existsSync(hostWitness)).toBe(false)
    expect(receiptOf(f, 1).vm).toEqual({
      room: f.roomId,
      socket: "/tmp/room-vm.sock",
      pid: 4242,
      started: true,
    })
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a VM the room already had is joined, not claimed", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest({
      start: { ok: true, socket: "/tmp/room-vm.sock", pid: 7, started: false },
    })

    const result = await runPass({
      id: f.roomId,
      worker: "true",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(true)
    expect(receiptOf(f, 1).vm?.started).toBe(false)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a VM that cannot start refuses the pass and leaves the event pending", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest({ start: { ok: false, reason: "RoomVmUnavailable: no supervisor" } })

    const result = await runPass({
      id: f.roomId,
      worker: "true",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("RoomVmUnavailable")
    // The refusal costs nothing: no receipt, no command, and the event is still work.
    expect(existsSync(join(workstreamDir(f.home), f.roomId + ".receipts", "0001.json"))).toBe(false)
    expect(guest.runs).toHaveLength(0)
    expect((await readEvents({ id: f.roomId, home: f.home }))[0]?.status).toBe("pending")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a worker the guest cannot run reports the gap", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest({
      run: () => ({
        ok: false,
        kind: "gap",
        reason: "RoomVmWorkerGap: room permissions-1862 could not run the worker in its guest",
      }),
    })

    const result = await runPass({
      id: f.roomId,
      worker: "pi --print",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("RoomVmWorkerGap")
    // The pass was charged and its event is still pending for whoever fixes the room.
    expect(receiptOf(f, 1).status).toBe("failed")
    expect((await readEvents({ id: f.roomId, home: f.home }))[0]?.status).toBe("pending")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("the guest's exit code is the pass's exit code", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest({
      run: () => ({ ok: true, status: 7, stdout: "spent", stderr: "" }),
    })

    const result = await runPass({
      id: f.roomId,
      worker: "true",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("worker exited 7")
    expect(receiptOf(f, 1).exit).toBe(7)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("an unbound pass stays on the host and asks for no guest", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f, { room: undefined })).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest()
    const hostWitness = join(f.root, "host.txt")

    const result = await runPass({
      id: f.roomId,
      worker: "printf host > " + hostWitness,
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(true)
    expect(guest.starts).toHaveLength(0)
    expect(guest.runs).toHaveLength(0)
    expect(readFileSync(hostWitness, "utf8")).toBe("host")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("an intercom worker is refused in a bound room instead of running on the host", async () => {
  const f = await fixture()
  try {
    expect((await adopted(f)).ok).toBe(true)
    await taskEvent(f)
    const guest = fakeGuest()

    const result = await runPass({
      id: f.roomId,
      worker: "intercom:01a1f5c7",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
      guest,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain("RoomVmHostWorker")
    expect(guest.runs).toHaveLength(0)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)
