/* oxlint-disable plumb/prefer-property-tests -- real supervisor processes over fixed scratch rooms; the assertions are isolation and persistence. */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { createRoom, readRoom, roomDir, setRoomRuntime } from "../src/store.ts"
import {
  readVmStatus,
  startVmSupervisor,
  stopVmSupervisor,
  vmExec,
  vmSocketFile,
  type VmExecResponse,
} from "../src/VmSupervisor.ts"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

/** A room-shaped scratch directory: the store's record, a checkout, and the room's own state. */
interface Scratch {
  readonly root: string
  readonly id: string
  readonly stateDir: string
  readonly worktree: string
  readonly close: () => Promise<void>
}

const scratchRoom = async (id: string): Promise<Scratch> => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-"))
  const created = await createRoom({
    root,
    id,
    repo: "autotelic/tackle",
    scope: id,
    base: "main",
    at: Date.now(),
  })
  if (!created.ok) throw new Error(created.error)
  const stateDir = roomDir({ root, id })
  const worktree = join(stateDir, "worktree")
  await mkdir(worktree, { recursive: true })
  return {
    root,
    id,
    stateDir,
    worktree,
    close: async () => {
      await stopVmSupervisor({ root, id })
      await rm(root, { recursive: true, force: true })
    },
  }
}

const started = async (room: Scratch) => {
  const outcome = await startVmSupervisor({
    root: room.root,
    id: room.id,
    worktree: room.worktree,
    stateDir: room.stateDir,
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.run
}

const runIn = async (
  socket: string,
  command: string,
  args: ReadonlyArray<string>,
): Promise<VmExecResponse> => {
  const response = await vmExec({ socket, request: { kind: "exec", command, args } })
  if (response.kind !== "result") throw new Error(response.message)
  return response
}

const roomCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
  })

test("two room supervisors keep separate filesystems", async () => {
  const left = await scratchRoom("left")
  const right = await scratchRoom("right")
  try {
    const a = await started(left)
    const b = await started(right)
    expect(a.pid).not.toBe(b.pid)

    const wrote = await runIn(a.socket, "sh", ["-c", "echo left > /workspace/only-left.txt"])
    expect(wrote.exitCode).toBe(0)

    // The other room's guest cannot read the file at all: it is not a filtered view of one
    // namespace but a second filesystem.
    const foreign = await runIn(b.socket, "cat", ["/workspace/only-left.txt"])
    expect(foreign.exitCode).not.toBe(0)
    expect(foreign.stdout).toBe("")
    expect(foreign.stderr).not.toBe("")

    // And on the host: each supervisor projects its own checkout, and its own database.
    expect(await readFile(join(left.worktree, "only-left.txt"), "utf8")).toBe("left\n")
    expect(existsSync(join(right.worktree, "only-left.txt"))).toBe(false)
    // Each VM keeps its sqlite database in its own room directory, never in the checkout.
    expect(a.database.startsWith(left.stateDir)).toBe(true)
    expect(b.database.startsWith(right.stateDir)).toBe(true)
  } finally {
    await left.close()
    await right.close()
  }
}, 120_000)

test("a command writes through /workspace into the room's checkout", async () => {
  const room = await scratchRoom("writer")
  try {
    const run = await started(room)
    const wrote = await runIn(run.socket, "sh", ["-c", "echo through > /workspace/written.txt"])
    expect(wrote.exitCode).toBe(0)
    expect(wrote.outcome).toBe("succeeded")
    expect(await readFile(join(room.worktree, "written.txt"), "utf8")).toBe("through\n")
  } finally {
    await room.close()
  }
}, 120_000)

test("a second command sees the state the first one left in the same VM", async () => {
  const room = await scratchRoom("keeper")
  try {
    const run = await started(room)
    // /tmp is the guest's, not the mount: a file there can only be visible to a command in the
    // same VM, which is the whole point of keeping one alive behind the socket.
    const first = await runIn(run.socket, "sh", ["-c", "echo carried > /tmp/carried.txt"])
    expect(first.exitCode).toBe(0)
    const second = await runIn(run.socket, "cat", ["/tmp/carried.txt"])
    expect(second.exitCode).toBe(0)
    expect(second.stdout).toBe("carried\n")

    // The same supervisor, not a second VM that happened to answer the same way.
    const status = await readVmStatus({ root: room.root, id: room.id })
    expect(status.state).toBe("running")
    expect(status.run?.pid).toBe(run.pid)
  } finally {
    await room.close()
  }
}, 120_000)

test("an expired executor lease is refused before any VM starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-"))
  const checkout = join(root, "checkout")
  await mkdir(checkout, { recursive: true })
  const lease = join(root, "lease.json")
  await writeFile(
    lease,
    JSON.stringify({
      version: 1,
      workstream: "tackle-runtime",
      issuedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:15:00.000Z",
      credentials: [{ id: "github", kind: "github" }],
      env: { GH_TOKEN: "secret" },
    }),
  )
  const paths = { root: join(root, ".room"), id: "dev" }
  try {
    const created = roomCli(
      root,
      "new",
      "--repo",
      join(root, "repo"),
      "--scope",
      "dev",
      "--worktree",
      checkout,
      "--id",
      "dev",
    )
    expect(created.status).toBe(0)
    const ran = roomCli(root, "vm", "--id", "dev", "--executor-lease", lease, "--", "echo", "hi")
    expect(ran.status).toBe(1)
    expect(ran.stderr).toContain("ExecutorLeaseExpired")
    expect(ran.stdout).toBe("")
    // Nothing was started: the refusal is the whole outcome, not a VM the caller paid for.
    expect((await readVmStatus(paths)).state).toBe("absent")
    expect(existsSync(vmSocketFile(paths))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("down stops the vm supervisor and releases the socket", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-"))
  const checkout = join(root, "checkout")
  await mkdir(checkout, { recursive: true })
  const paths = { root: join(root, ".room"), id: "dev" }
  try {
    expect(
      roomCli(
        root,
        "new",
        "--repo",
        join(root, "repo"),
        "--scope",
        "dev",
        "--worktree",
        checkout,
        "--id",
        "dev",
      ).status,
    ).toBe(0)
    const start = roomCli(root, "vm", "start", "--id", "dev")
    expect(start.status).toBe(0)
    const live = await readVmStatus(paths)
    expect(live.state).toBe("running")
    expect(existsSync(vmSocketFile(paths))).toBe(true)

    // The placement is recorded, and status names it.
    expect((await readRoom(paths))?.runtime).toEqual({ kind: "agentos" })
    expect(roomCli(root, "status", "--id", "dev").stdout).toContain("runtime agentos")

    const down = roomCli(root, "down", "--id", "dev")
    expect(down.status).toBe(0)
    expect(down.stdout).toContain("vm supervisor " + live.run?.pid)
    expect((await readVmStatus(paths)).state).toBe("absent")
    expect(existsSync(vmSocketFile(paths))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("a dead supervisor pid is stale, not a live pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-"))
  const checkout = join(root, "checkout")
  await mkdir(checkout, { recursive: true })
  const paths = { root: join(root, ".room"), id: "dev" }
  try {
    expect(
      roomCli(
        root,
        "new",
        "--repo",
        join(root, "repo"),
        "--scope",
        "dev",
        "--worktree",
        checkout,
        "--id",
        "dev",
      ).status,
    ).toBe(0)
    expect(roomCli(root, "vm", "start", "--id", "dev").status).toBe(0)
    const live = await readVmStatus(paths)
    expect(live.state).toBe("running")
    if (live.run === undefined) throw new Error("no supervisor record")
    // SIGKILL leaves the record and the socket file behind, which is the debris a stop must
    // recognise: the pid answers nothing, so nothing is live.
    // The group, not just the leader: a sidecar left behind would keep the VM's files in play.
    process.kill(-live.run.pid, "SIGKILL")
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await readVmStatus(paths)).state === "stale") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const stale = await readVmStatus(paths)
    expect(stale.state).toBe("stale")
    const stop = roomCli(root, "vm", "stop", "--id", "dev")
    expect(stop.status).toBe(0)
    expect(stop.stdout).toContain("stale vm supervisor")
    expect((await readVmStatus(paths)).state).toBe("absent")
    expect(existsSync(vmSocketFile(paths))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("a room file decodes with and without a runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-"))
  try {
    const created = await createRoom({
      root,
      id: "dev",
      repo: "autotelic/tackle",
      scope: "dev",
      base: "main",
      at: Date.now(),
    })
    expect(created.ok).toBe(true)
    // A room written before placement was recorded has no runtime key at all, and it still
    // decodes: absent means the local worktree, which is what every older room has.
    const written = JSON.parse(await readFile(join(root, "dev", "room.json"), "utf8"))
    expect("runtime" in written).toBe(false)
    expect((await readRoom({ root, id: "dev" }))?.runtime).toBeUndefined()

    const placed = await setRoomRuntime({ root, id: "dev", runtime: { kind: "agentos" } })
    expect(placed.ok).toBe(true)
    expect((await readRoom({ root, id: "dev" }))?.runtime).toEqual({ kind: "agentos" })
    expect(JSON.parse(await readFile(join(root, "dev", "room.json"), "utf8")).runtime).toEqual({
      kind: "agentos",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
