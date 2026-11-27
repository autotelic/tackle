/* oxlint-disable plumb/prefer-property-tests -- real agentOS VMs over fixed scratch rooms; the assertion is which observation the guest earned. */
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import type { ServiceObservation } from "../src/Service.ts"
import { createRoom, readRoom, roomDir } from "../src/store.ts"
import {
  observeVmService,
  startVmSupervisor,
  stopVmService,
  stopVmSupervisor,
  vmService,
  type VmRun,
} from "../src/VmSupervisor.ts"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

/** The one declaration every case observes; the command is the fixture's, not the room's. */
const web = { name: "web", command: "node server.js", healthPath: "/healthz" }

/** A room-shaped scratch directory: the store's record, a checkout, and the room's own state. */
interface Scratch {
  readonly root: string
  readonly id: string
  readonly stateDir: string
  readonly worktree: string
  readonly close: () => Promise<void>
}

const scratchRoom = async (id: string): Promise<Scratch> => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-service-"))
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

const started = async (room: Scratch): Promise<VmRun> => {
  const outcome = await startVmSupervisor({
    root: room.root,
    id: room.id,
    worktree: room.worktree,
    stateDir: room.stateDir,
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.run
}

/** Start one long-lived guest program and return the pid the VM's own table named it by. */
const spawnGuest = async (
  socket: string,
  command: string,
  args: ReadonlyArray<string>,
): Promise<number> => {
  const response = await vmService({
    socket,
    request: { kind: "service", command, args: [...args] },
  })
  if (response.kind !== "service") throw new Error("unexpected service response: " + response.kind)
  return response.pid
}

/**
 * Observe until the service reaches the state under test.
 *
 * A just-spawned listener needs a moment to bind, so the first look at a healthy service is an
 * honest "nothing answered yet"; every case polls until the fact it is about exists, then asserts
 * the whole observation once.
 */
const observeUntil = async (input: {
  readonly root: string
  readonly id: string
  readonly port: number
  readonly pid: number | undefined
  readonly want: (observed: ServiceObservation) => boolean
}): Promise<ServiceObservation> => {
  let last: ServiceObservation | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    const observed = await observeVmService({
      root: input.root,
      id: input.id,
      service: web,
      port: input.port,
      pid: input.pid,
      checkedAt: new Date().toISOString(),
    })
    if (input.want(observed)) return observed
    last = observed
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("the service never reached the expected state: " + JSON.stringify(last))
}

const roomCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
  })

/** The guest program that answers one health path, in the shape a real service has. */
const answering = (port: number, status: number): ReadonlyArray<string> => [
  "-e",
  "require('http').createServer((q,r)=>{r.writeHead(" +
    status +
    ",{'content-type':'text/plain'});r.end('ok')}).listen(" +
    port +
    ")",
]

test("a guest service that answers its health path is healthy", async () => {
  const room = await scratchRoom("healthy")
  try {
    const run = await started(room)
    const pid = await spawnGuest(run.socket, "node", answering(4831, 200))
    const observed = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4831,
      pid,
      want: (candidate) => candidate.status === "healthy",
    })
    expect(observed).toEqual({
      name: "web",
      command: "node server.js",
      port: 4831,
      healthPath: "/healthz",
      status: "healthy",
      detail: null,
      checkedAt: observed.checkedAt,
    })
  } finally {
    await room.close()
  }
}, 120_000)

test("a guest service that exited is stopped with its code, whatever the port answers", async () => {
  const room = await scratchRoom("exited")
  try {
    const run = await started(room)
    // A listener that would make any port probe report healthy. The process table is the
    // authority for the service under test, so this answer must not be able to revive it.
    const listener = await spawnGuest(run.socket, "node", answering(4832, 200))
    const gone = await spawnGuest(run.socket, "sh", ["-c", "exit 7"])
    const observed = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4832,
      pid: gone,
      want: (candidate) => candidate.status === "stopped",
    })
    expect(observed.detail).toBe("the guest service exited with code 7")
    // The listener is still healthy under its own pid: two processes, two findings.
    const alive = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4832,
      pid: listener,
      want: (candidate) => candidate.status === "healthy",
    })
    expect(alive.detail).toBeNull()
  } finally {
    await room.close()
  }
}, 120_000)

test("a live guest service that answers outside 2xx is unhealthy, not stopped", async () => {
  const room = await scratchRoom("unhealthy")
  try {
    const run = await started(room)
    const pid = await spawnGuest(run.socket, "node", answering(4833, 503))
    const observed = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4833,
      pid,
      // Wait for the listener to bind and answer 503; a first look can arrive before Node has
      // opened the port, which is an honest "nothing answered" but not this test's fact.
      want: (candidate) => candidate.status === "unhealthy" && candidate.detail === "answered 503",
    })
    expect(observed.detail).toBe("answered 503")
  } finally {
    await room.close()
  }
}, 120_000)

test("a live guest process that never listens is unhealthy, and a kill stops it", async () => {
  const room = await scratchRoom("silent")
  try {
    const run = await started(room)
    // Alive and answering nothing: the two facts must stay apart, so this is not "stopped".
    const pid = await spawnGuest(run.socket, "sh", ["-c", "sleep 300"])
    const observed = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4834,
      pid,
      want: (candidate) => candidate.status === "unhealthy",
    })
    expect(observed.detail).not.toBeNull()

    const killed = await stopVmService({ root: room.root, id: room.id, pid })
    expect(killed.stopped).toBe(true)
    const after = await observeUntil({
      root: room.root,
      id: room.id,
      port: 4834,
      pid,
      want: (candidate) => candidate.status === "stopped",
    })
    expect(after.detail).toContain("the guest service")
  } finally {
    await room.close()
  }
}, 120_000)

test("room vm serve records the guest pid and room vm stop kills it", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-service-"))
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
    // A service that never answers its path: the room still has to say which process it looked
    // at, and the stop still has to reach that process.
    const served = roomCli(
      root,
      "vm",
      "serve",
      "--id",
      "dev",
      "--port",
      "4841",
      "--exec",
      "sleep 300",
      "--health",
      "/",
    )
    expect(served.status).toBe(0)
    const recorded = await readRoom(paths)
    expect(recorded?.runtime?.previewPort).toBe(4841)
    const pid = recorded?.runtime?.servicePid
    expect(pid).toBeGreaterThan(0)

    const status = roomCli(root, "status", "--id", "dev", "--json")
    expect(status.status).toBe(0)
    const observed = JSON.parse(status.stdout)
    expect(observed.service.status).toBe("unhealthy")
    expect(observed.service.detail).not.toBeNull()

    const stop = roomCli(root, "vm", "stop", "--id", "dev")
    expect(stop.status).toBe(0)
    expect(stop.stdout).toContain("vm service " + pid + " killed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)

test("room down kills the guest service before the VM it lives in", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-service-"))
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
    expect(
      roomCli(
        root,
        "vm",
        "serve",
        "--id",
        "dev",
        "--port",
        "4842",
        "--exec",
        "sleep 300",
        "--health",
        "/",
      ).status,
    ).toBe(0)
    const pid = (await readRoom(paths))?.runtime?.servicePid
    expect(pid).toBeGreaterThan(0)
    const down = roomCli(root, "down", "--id", "dev")
    expect(down.status).toBe(0)
    expect(down.stdout).toContain("killed vm service " + pid)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 180_000)

test("a room file written before the guest pid decodes and claims no process", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-service-"))
  try {
    const state = { _tag: "Ready", repo: "/repo", scope: "dev", createdAt: 1_767_225_600_000 }
    const written = {
      id: "dev",
      base: "main",
      state,
      service: web,
      runtime: { kind: "agentos", previewPort: 4851 },
    }
    await mkdir(join(root, "dev"), { recursive: true })
    await writeFile(join(root, "dev", "room.json"), JSON.stringify(written, null, 2) + "\n")
    const room = await readRoom({ root, id: "dev" })
    // Absent means the room was served before the pid was kept; the file is not rewritten.
    expect(room?.runtime).toEqual({ kind: "agentos", previewPort: 4851 })
    expect(room?.runtime?.servicePid).toBeUndefined()
    const observed = await observeVmService({
      root,
      id: "dev",
      service: web,
      port: 4851,
      pid: room?.runtime?.servicePid,
      checkedAt: "2026-11-22T12:00:00.000Z",
    })
    expect(observed.status).toBe("stopped")
    expect(observed.detail).toBe("no vm supervisor")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
