/* oxlint-disable plumb/prefer-property-tests -- real supervisor processes over fixed scratch rooms; the assertions are what a resume restores. */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { readRoom } from "../src/store.ts"
import { snapshotGuard, snapshotHash } from "../src/VmSnapshot.ts"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

/** A room made by the CLI over a scratch checkout, so nothing here re-creates the store. */
interface Scratch {
  readonly cwd: string
  /** The `.room` root: where `room.json`, the worktree and the snapshots live. */
  readonly root: string
  readonly id: string
  readonly stateDir: string
  readonly checkout: string
  readonly close: () => Promise<void>
}

const roomCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
  })

const git = (cwd: string, ...args: ReadonlyArray<string>): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

/** A committed repository, so `room new` makes a real worktree for the VM to project. */
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

const scratchRoom = (label: string): Scratch => {
  const cwd = mkdtempSync(join(tmpdir(), "room-snapshot-" + label + "-"))
  const created = roomCli(cwd, "new", "--repo", repository(cwd), "--scope", label, "--id", label)
  if (created.status !== 0) throw new Error("room new failed: " + created.stderr)
  return {
    cwd,
    root: join(cwd, ".room"),
    id: label,
    stateDir: join(cwd, ".room", label),
    checkout: join(cwd, ".room", label, "worktree"),
    close: () => rm(cwd, { recursive: true, force: true }),
  }
}

/** Run one command in the room's VM, booting its supervisor when none is running. */
const guest = (room: Scratch, command: ReadonlyArray<string>) =>
  roomCli(room.cwd, "vm", "--id", room.id, "--", ...command)

test("a paused room's guest root is restored by resume", async () => {
  const room = scratchRoom("restore")
  try {
    // A file in the guest's own root, outside the host mount: nothing on the host holds it, so a
    // resumed VM can only read it back from the snapshot the pause wrote.
    const wrote = guest(room, ["sh", "-c", "echo durable > /tmp/durable.txt"])
    expect(wrote.status).toBe(0)
    expect(existsSync(join(room.checkout, "durable.txt"))).toBe(false)

    const paused = roomCli(room.cwd, "pause", "--id", room.id)
    expect(paused.status).toBe(0)
    const record = await readRoom({ root: room.root, id: room.id })
    const snapshot = record?.runtime?.snapshot
    if (snapshot === undefined)
      throw new Error("pause recorded no snapshot: " + paused.stdout + paused.stderr)

    // The snapshot is beside the room record, never inside the worktree, and its hash is the
    // hash of the bytes that are actually there.
    expect(existsSync(snapshot.path)).toBe(true)
    expect(snapshot.path.startsWith(room.checkout)).toBe(false)
    expect(existsSync(join(room.checkout, basename(snapshot.path)))).toBe(false)
    const text = await readFile(snapshot.path, "utf8")
    expect(text).toContain("/tmp/durable.txt")
    expect(snapshot.sha256).toBe(snapshotHash(text))
    expect(snapshot.bytes).toBe(Buffer.byteLength(text, "utf8"))
    expect(snapshot.entries).toBeGreaterThan(0)

    // A snapshot is the pause: the VM that held the disk is gone, not frozen behind the record.
    const status = roomCli(room.cwd, "vm", "status", "--id", room.id, "--json")
    expect(JSON.parse(status.stdout).state).toBe("absent")

    const resumed = roomCli(room.cwd, "resume", "--id", room.id)
    expect(resumed.status).toBe(0)
    expect(resumed.stdout).toContain("restored snapshot")
    expect((await readRoom({ root: room.root, id: room.id }))?.state._tag).toBe("Ready")

    const read = guest(room, ["cat", "/tmp/durable.txt"])
    expect(read.status).toBe(0)
    expect(read.stdout).toBe("durable\n")
  } finally {
    await room.close()
  }
}, 180_000)

test("a second pause of a resumed room writes its own snapshot", async () => {
  const room = scratchRoom("again")
  try {
    expect(guest(room, ["sh", "-c", "echo first > /tmp/first.txt"]).status).toBe(0)
    expect(roomCli(room.cwd, "pause", "--id", room.id).status).toBe(0)
    const first = (await readRoom({ root: room.root, id: room.id }))?.runtime?.snapshot
    if (first === undefined) throw new Error("the first pause recorded no snapshot")

    const resumed = roomCli(room.cwd, "resume", "--id", room.id)
    expect(resumed.status).toBe(0)
    // The restore is real: the file the paused VM wrote is in the resumed VM before it is asked
    // for anything else.
    const restored = guest(room, ["cat", "/tmp/first.txt"])
    expect(restored.status).toBe(0)
    expect(restored.stdout).toBe("first\n")

    expect(guest(room, ["sh", "-c", "echo second > /tmp/second.txt"]).status).toBe(0)
    expect(roomCli(room.cwd, "pause", "--id", room.id).status).toBe(0)
    const second = (await readRoom({ root: room.root, id: room.id }))?.runtime?.snapshot
    if (second === undefined) throw new Error("the second pause recorded no snapshot")

    // Not a duplicate export: a later generation, its own file, its own bytes — and the file the
    // resumed VM was built from still holds what it held.
    expect(second.generation).toBe(first.generation + 1)
    expect(second.path).not.toBe(first.path)
    expect(second.sha256).not.toBe(first.sha256)
    expect(await readFile(first.path, "utf8")).toContain("/tmp/first.txt")
    expect(await readFile(second.path, "utf8")).toContain("/tmp/second.txt")
  } finally {
    await room.close()
  }
}, 180_000)

test("a snapshot failure leaves the room paused with the reason", async () => {
  const room = scratchRoom("unwritable")
  try {
    // A directory where the first snapshot belongs makes the one write that matters fail. The
    // pause must survive it: the room is paused, and it says no snapshot was written.
    await mkdir(join(room.stateDir, "vm-snapshot-1.json"), { recursive: true })
    expect(guest(room, ["sh", "-c", "echo kept > /tmp/kept.txt"]).status).toBe(0)

    const paused = roomCli(room.cwd, "pause", "--id", room.id)
    expect(paused.status).toBe(0)
    expect(paused.stdout).toContain("no snapshot was written")

    const record = await readRoom({ root: room.root, id: room.id })
    expect(record?.state._tag).toBe("Paused")
    // Never a false claim: no snapshot is recorded, and the reason is the record's own words.
    expect(record?.runtime?.snapshot).toBeUndefined()
    expect(record?.runtime?.snapshotError ?? "").toContain("vm-snapshot-1.json")
  } finally {
    await room.close()
  }
}, 180_000)

test("a snapshot that carries the host mount is refused as an API gap", () => {
  const exported = (paths: ReadonlyArray<string>) => ({
    source: { filesystem: { entries: paths.map((path) => ({ path })) } },
  })
  // The mount point itself is part of the root filesystem: an empty /workspace is fine.
  expect(snapshotGuard(exported(["/", "/tmp", "/workspace"])).ok).toBe(true)

  const carried = snapshotGuard(exported(["/tmp/kept.txt", "/workspace/src/index.ts"]))
  expect(carried.ok).toBe(false)
  if (carried.ok) throw new Error("the guard accepted the host mount")
  expect(carried.reason).toContain("API gap")
  expect(carried.reason).toContain("/workspace/src/index.ts")
})
