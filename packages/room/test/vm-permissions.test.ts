/* oxlint-disable plumb/prefer-property-tests -- one real agentOS VM over a scratch room plus pure decodes; the assertion is what the guest could reach and what the record says. */
import { Effect, Schema } from "effect"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { createAgentOsRoom, type AgentOsRoom } from "../src/AgentOs.ts"
import { createRoom, readRoom, roomDir, roomFile } from "../src/store.ts"
import {
  NetworkPolicy,
  permissionsLine,
  roomAllowedHosts,
  roomVmPermissions,
} from "../src/VmPermissions.ts"
import { readVmRun, stopVmSupervisor } from "../src/VmSupervisor.ts"

/*
 * Cut 4 of docs/tech-seams.md: a room declares the reach of its guest, and the record is what an
 * operator reads. The policy half is the room's (`roomVmPermissions`); the sidecar half is the
 * runtime's own `describe()`, which at 0.4.9 says nothing about permissions — ADR 0007 records
 * that gap, and these tests hold the record to what it can actually claim.
 */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

const roomCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

/** A room-shaped scratch directory: the store's record, a checkout, and the room's own state. */
interface Scratch {
  readonly root: string
  readonly id: string
  readonly stateDir: string
  readonly close: () => Promise<void>
}

const scratchRoom = async (id: string): Promise<Scratch> => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-permissions-"))
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
  await mkdir(join(stateDir, "worktree"), { recursive: true })
  return {
    root,
    id,
    stateDir,
    close: async () => {
      await stopVmSupervisor({ root, id })
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** One guest program that fetches a URL and says which outcome it earned. */
const fetchInGuest = (url: string): ReadonlyArray<string> => [
  "-e",
  "fetch('" +
    url +
    "').then(" +
    "() => { console.log('reached'); process.exit(0) }, " +
    "(cause) => { console.log('blocked: ' + (cause && cause.message)); process.exit(1) })",
]

/** Wait for a just-spawned guest listener to answer, so a first miss is not the assertion. */
const listening = async (room: AgentOsRoom, port: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const answered = await room.vm.network
      .httpRequest({ port, path: "/" })
      .then(() => true)
      .catch(() => false)
    if (answered) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

const guest = (room: AgentOsRoom, command: ReadonlyArray<string>) =>
  room.vm.process.execFile(command[0] ?? "sh", command.slice(1), {
    cwd: room.workspace,
    output: { capture: "all" },
  })

test("the room's VM is created with an explicit network policy, not the sidecar default", () => {
  const network = roomVmPermissions.network
  if (typeof network !== "object" || network === undefined)
    throw new Error("the room declares no rule-set network scope: " + JSON.stringify(network))
  // Deny is the decision: an unmatched request is refused, so every allowance below is named.
  expect(network.default).toBe("deny")
  // A listener is what a room's service is. The runtime already refuses a non-loopback bind, so
  // the rule carries no pattern of its own.
  expect(network.rules).toContainEqual({ mode: "allow", operations: ["network.listen"] })
  // The only hosts a guest may reach are its own: the room's service, and nothing outside it.
  expect(network.rules).toContainEqual({
    mode: "allow",
    operations: ["network.fetch", "network.http", "network.dns"],
    patterns: [...roomAllowedHosts],
  })
  // Every allowance is loopback; no rule names an external host.
  for (const rule of network.rules)
    for (const pattern of rule.patterns ?? []) expect(roomAllowedHosts).toContain(pattern)
})

test("a room whose boot recorded no policy prints no line, never a guessed one", () => {
  expect(permissionsLine(undefined)).toBe("")
  // A record that names the policy but no sidecar keeps the policy and claims nothing about
  // the runtime: the missing half is silence, not a filled-in "ready".
  const recorded = Schema.decodeUnknownSync(NetworkPolicy)(roomVmPermissions.network)
  expect(permissionsLine({ declared: ["network"], network: recorded })).toBe(
    " permissions network deny allow " + roomAllowedHosts.join(","),
  )
})

test("a room file written before the policy was recorded still decodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-vm-permissions-old-"))
  try {
    const created = await createRoom({
      root,
      id: "old",
      repo: "autotelic/tackle",
      scope: "old",
      base: "main",
      at: Date.now(),
    })
    if (!created.ok) throw new Error(created.error)
    // An older room: placed on a VM, with no permission field at all.
    const file = roomFile({ root, id: "old" })
    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
    written.runtime = { kind: "agentos", previewPort: 4300 }
    await writeFile(file, JSON.stringify(written, null, 2) + "\n")

    const room = await readRoom({ root, id: "old" })
    expect(room?.runtime?.permissions).toBeUndefined()
    expect(permissionsLine(room?.runtime?.permissions)).toBe("")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a guest fetch outside the room's allowlist fails, and one to its own service does not", async () => {
  const room = await Effect.runPromise(createAgentOsRoom({ id: "allowlist" }))
  try {
    // The listener is the room's own service: a loopback port inside the guest.
    const port = 4841
    const server = await room.vm.process.spawn(
      "node",
      ["-e", "require('http').createServer((q,r)=>r.end('ok')).listen(" + port + ", '127.0.0.1')"],
      { cwd: room.workspace },
    )
    expect(await listening(room, port), "the guest never bound " + port).toBe(true)

    // Positive control: the same fetch the blocked case runs, against an allowlisted host. This
    // is what makes the failure below the policy rather than a guest with no network at all.
    const own = await guest(room, ["node", ...fetchInGuest("http://127.0.0.1:" + port + "/")])
    expect(own.exitCode, own.stderr).toBe(0)
    expect(own.stdout).toContain("reached")

    // Outside: a model-API host the sidecar's own default allowlist grants, which this room's
    // policy denies. The failure must be the policy, not a missing global or a dead runtime.
    const outside = await guest(room, ["node", ...fetchInGuest("https://api.anthropic.com/")])
    expect(outside.exitCode, outside.stdout).not.toBe(0)
    expect(outside.stdout).toContain("blocked")
    expect(outside.stdout).not.toContain("is not defined")

    await room.vm.process.kill(server.pid).catch(() => undefined)
  } finally {
    await room.dispose()
  }
}, 120_000)

test("the boot records the policy it applied and the sidecar's own description", async () => {
  const room = await Effect.runPromise(createAgentOsRoom({ id: "recorded" }))
  try {
    // The policy half is the room's declaration, verbatim.
    expect(room.permissions.declared).toEqual(["network"])
    expect(room.permissions.network).toEqual(roomVmPermissions.network)
    // The sidecar half is what describe() answered: identity and state, not a policy.
    expect(room.permissions.sidecar?.sidecarId).not.toBe("")
    expect(room.permissions.sidecar?.state).toBe("ready")
    expect(room.permissions.sidecar?.activeVmCount).toBeGreaterThanOrEqual(1)
    expect(permissionsLine(room.permissions)).toContain("permissions network deny")
    expect(permissionsLine(room.permissions)).toContain("sidecar ready")
  } finally {
    await room.dispose()
  }
}, 60_000)

test("a room records the policy in room.json and the run file, and prints the line", async () => {
  const room = await scratchRoom("recorded-room")
  try {
    const ran = roomCli(
      room.root,
      "vm",
      "--id",
      room.id,
      "--root",
      room.root,
      "--",
      "sh",
      "-c",
      "echo ok",
    )
    expect(ran.status, ran.stderr).toBe(0)

    const recorded = await readRoom({ root: room.root, id: room.id })
    const permissions = recorded?.runtime?.permissions
    if (permissions === undefined)
      throw new Error("the room recorded no policy: " + JSON.stringify(recorded?.runtime))
    expect(permissions.network).toEqual(roomVmPermissions.network)
    expect(permissions.sidecar?.state).toBe("ready")

    // The supervisor's own record says the same thing, written by the process that booted the VM.
    const run = await readVmRun({ root: room.root, id: room.id })
    expect(run?.permissions).toEqual(permissions)

    const status = roomCli(room.root, "status", "--id", room.id, "--root", room.root)
    expect(status.status, status.stderr).toBe(0)
    expect(status.stdout).toContain("permissions network deny")
  } finally {
    await room.close()
  }
}, 120_000)
