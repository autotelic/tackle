import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Option, Schema } from "effect"
import { expect, test } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const run = (
  args: ReadonlyArray<string>,
  cwd: string,
  env: Readonly<Record<string, string>> = {},
) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

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

test("presence serves each workstream's repo gate", () => {
  const root = mkdtempSync(join(tmpdir(), "board-gate-"))
  try {
    const checkout = join(root, "checkout")
    mkdirSync(checkout, { recursive: true })
    writeFileSync(
      join(checkout, ".jig-baseline.json"),
      JSON.stringify({
        lexicon: { name: "baseline", version: 1 },
        identities: ["plumb/no-raw-html:src/a.ts"],
      }),
    )
    const factoryHome = join(root, "factory")
    const workstreams = join(factoryHome, "workstreams")
    mkdirSync(join(workstreams, "gate-probe.receipts"), { recursive: true })
    writeFileSync(
      join(workstreams, "gate-probe.json"),
      JSON.stringify({
        version: 1,
        id: "gate-probe",
        project: "factory",
        label: "factory-feedback",
        repo: "autotelic/tackle",
        path: checkout,
        branch: "main",
        head: "0".repeat(40),
        delivery: "trunk",
        base: "main",
        baseSha: "0".repeat(40),
        prHead: "0".repeat(40),
        diverged: false,
        phase: "build",
        deps: [],
        lease: { holder: "test", generation: 1 },
        cursors: { github: "", linear: "" },
        budgets: {
          passesPerPhase: 5,
          wallMinutesPerPass: 30,
          tokensPerDay: 0,
          roundsOfChanges: 2,
        },
        autonomy: [],
        desk: [],
        protectedPaths: [],
        checkpoint: {
          sha: "0".repeat(40),
          ref: "refs/bench/gate-probe",
          at: "2026-11-22T10:00:00.000Z",
          pushed: false,
        },
        createdAt: "2026-11-22T09:00:00.000Z",
        updatedAt: "2026-11-22T10:00:00.000Z",
      }),
    )
    const quality = { available: true, errors: 0, warnings: 0, note: "jig check" }
    writeFileSync(
      join(workstreams, "gate-probe.receipts", "0002.json"),
      JSON.stringify({
        workstream: "gate-probe",
        pass: 2,
        at: "2026-11-22T10:30:00.000Z",
        status: "done",
        phase: "build",
        events: [],
        quality: {
          before: quality,
          after: { ...quality, errors: 3, warnings: 1 },
          regressed: false,
        },
      }),
    )

    const output = run(["presence", "--json", "--root", "rooms"], root, {
      FACTORY_HOME: factoryHome,
    })
    expect(output.status).toBe(0)
    const presence = JSON.parse(output.stdout)
    const served = presence.factory.workstreams.find(
      (workstream: { id: string }) => workstream.id === "gate-probe",
    )
    expect(served.gate).toMatchObject({
      repo: "autotelic/tackle",
      path: checkout,
      baseline: {
        state: "present",
        file: ".jig-baseline.json",
        identities: 1,
        newestAccepted: null,
      },
      quality: { state: "measured", pass: 2, errors: 3, warnings: 1 },
    })
    expect(served.gate.baseline.note).toContain("newest accepted is not recorded")
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

test("board up on another address also answers on loopback", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-loopback-"))
  try {
    mkdirSync(join(root, "rooms"), { recursive: true })
    // ::1 stands in for a tailnet address: it binds without privileges and is not loopback.
    const bindable = await new Promise<boolean>((resolve) => {
      const probe = createServer()
      probe.once("error", () => resolve(false))
      probe.listen(0, "::1", () => probe.close(() => resolve(true)))
    })
    if (!bindable) return
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    const up = run(
      ["up", "--root", "rooms", "--host", "::1", "--port", String(port), "--detach"],
      root,
    )
    expect(up.status, up.stderr).toBe(0)
    for (const origin of ["http://[::1]:", "http://127.0.0.1:"]) {
      const health = await fetch(origin + port + "/health")
      expect(health.status, origin).toBe(200)
      expect(await health.json()).toMatchObject({ ok: true, shop: "rooms" })
    }
    const presence = await fetch("http://127.0.0.1:" + port + "/presence")
    expect(presence.status).toBe(200)
    expect(await presence.json()).toMatchObject({ shop: "rooms" })
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

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

const workstreamRecord = (input: {
  readonly id: string
  readonly path: string
  readonly label: string
}): string =>
  JSON.stringify({
    version: 1,
    id: input.id,
    project: "factory",
    label: input.label,
    repo: "autotelic/tackle",
    path: input.path,
    branch: "main",
    head: "0".repeat(40),
    delivery: "trunk",
    base: "main",
    baseSha: "0".repeat(40),
    prHead: "0".repeat(40),
    diverged: false,
    phase: "build",
    deps: [],
    lease: { holder: "test", generation: 1 },
    cursors: { github: "", linear: "" },
    budgets: {
      passesPerPhase: 5,
      wallMinutesPerPass: 30,
      tokensPerDay: 0,
      roundsOfChanges: 2,
    },
    autonomy: [],
    desk: [],
    checkpoint: {
      sha: "0".repeat(40),
      ref: "refs/bench/" + input.id,
      at: "2026-11-22T10:00:00.000Z",
      pushed: false,
    },
    createdAt: "2026-11-22T09:00:00.000Z",
    updatedAt: "2026-11-22T10:00:00.000Z",
  })

test("presence carries an environment for every workstream", () => {
  const root = mkdtempSync(join(tmpdir(), "board-env-"))
  try {
    const factoryHome = join(root, "factory")
    const workstreams = join(factoryHome, "workstreams")
    mkdirSync(workstreams, { recursive: true })
    // One workstream runs in a room whose lease is live, so the port join has a fact to find.
    const roomWorktree = join(root, "rooms", "feedback-room", "worktree")
    mkdirSync(roomWorktree, { recursive: true })
    mkdirSync(join(root, "rooms", "feedback-room"), { recursive: true })
    const leasedAt = 1_760_000_000_000
    writeFileSync(
      join(root, "rooms", "feedback-room", "room.json"),
      JSON.stringify({
        id: "feedback-room",
        base: "main",
        state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
        port: { number: 4400, leasedAt },
      }),
    )
    const records = [
      { id: "shakti-perms", path: join(root, "shakti-perms"), label: "shakti-perms" },
      { id: "factory-feedback", path: roomWorktree, label: "factory-feedback" },
    ]
    for (const record of records)
      writeFileSync(join(workstreams, record.id + ".json"), workstreamRecord(record))

    const output = run(["presence", "--json", "--root", "rooms"], root, {
      FACTORY_HOME: factoryHome,
    })
    expect(output.status, output.stderr).toBe(0)
    const presence = JSON.parse(output.stdout)
    const environments = presence.factory.environments
    // Records are listed in file-name order, so the served order is the id order.
    const ordered = records.toSorted((left, right) => left.id.localeCompare(right.id))
    expect(
      environments.map((environment: { workstream: string }) => environment.workstream),
    ).toEqual(ordered.map((record) => record.id))
    for (const [index, environment] of environments.entries()) {
      expect(environment).toEqual({
        workstream: ordered[index]?.id,
        // The machine is the tailnet's self entry. A host without the daemon has no self, and
        // the field is then null rather than a hostname from somewhere else.
        machine:
          environment.machine === null
            ? null
            : { host: environment.machine.host, dnsName: environment.machine.dnsName },
        runtime: { kind: "worktree", path: ordered[index]?.path },
        // A port is served only when a room's lease names this worktree; a null here is the
        // honest answer for a workstream that no room holds.
        port:
          environment.port === null
            ? null
            : {
                room: environment.port.room,
                number: environment.port.number,
                leasedAt: environment.port.leasedAt,
              },
        vmPort: null,
        // Nothing declares a service and nothing routes to a preview, so both stay at their
        // empty value rather than being filled by a neighbour.
        services: [],
        preview: null,
        observedAt: presence.observedAt,
        // A live session on this machine may legitimately claim the workstream by its label or
        // cwd, so the agent is either no session at all or one the board actually observed. It
        // is never a placeholder (the unit test pins the null case deterministically).
        agent:
          environment.agent === null
            ? null
            : {
                session: environment.agent.session,
                status: environment.agent.status,
              },
      })
      if (environment.agent !== null) expect(environment.agent.session.length).toBeGreaterThan(0)
      expect(environment).not.toHaveProperty("container")
      expect(environment).not.toHaveProperty("health")
    }
    // The room's lease reaches the document through its worktree, and the other workstream
    // stays null rather than sharing it.
    expect(environments[0]?.port).toEqual({
      room: "feedback-room",
      number: 4400,
      leasedAt: new Date(leasedAt).toISOString(),
    })
    expect(environments[1]?.port).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * The one-shot command, awaited rather than spawned synchronously: a fixture server in this
 * process cannot answer a probe while the event loop is blocked on a child.
 */
const runAsync = async (
  args: ReadonlyArray<string>,
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): Promise<{
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}> => {
  const child = spawn(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    env: { ...process.env, ...env },
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => (stderr += chunk))
  const status = await new Promise<number | null>((resolve) => child.once("close", resolve))
  return { status, stdout, stderr }
}

/**
 * A port nothing listens on, as nearly as a test can know: bind one and hand it straight back.
 * A refused connection is what a room with no service running in it actually produces, and it
 * is the case a preview route must report rather than pass off as an empty answer.
 */
const releasedPort = async (): Promise<number> => {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  // `address()` is a union of null, a string and an object; decoding it keeps that union out of
  // the assertion instead of reading its shape by hand. The rule against decodeUnknownOption is
  // about production callers losing issue trees; here None is the only possible outcome of a
  // successful bind, and the assertion below fails loudly if it happens.
  const bound = Schema.decodeUnknownOption(Schema.Struct({ port: Schema.Int }))(probe.address())
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const port = Option.getOrElse(bound, () => ({ port: 0 })).port
  expect(port).toBeGreaterThan(0)
  return port
}

test("presence serves the status a probe observed for a declared service", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-service-"))
  const server = createServer((request, response) => {
    const answering = request.url === "/healthz"
    response.writeHead(answering ? 200 : 500, { "content-type": "text/plain" })
    response.end("answer\n")
  })
  try {
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolve)
    })
    const factoryHome = join(root, "factory")
    const workstreams = join(factoryHome, "workstreams")
    mkdirSync(workstreams, { recursive: true })
    const declared = { name: "web", command: "node server.js", healthPath: "/healthz" }
    const rooms = join(root, "rooms")
    // One room's supervisor is alive and its service answers the health path. The other
    // declares the same service but has no run record, so the probe opens no socket at all.
    const fixtures = [
      {
        id: "answering",
        port,
        run: { pid: process.pid, exec: "node server.js", startedAt: 1, log: "/tmp/room.log" },
      },
      { id: "idle", port: port + 1, run: undefined },
    ]
    for (const fixture of fixtures) {
      const worktree = join(rooms, fixture.id, "worktree")
      mkdirSync(worktree, { recursive: true })
      writeFileSync(
        join(rooms, fixture.id, "room.json"),
        JSON.stringify({
          id: fixture.id,
          base: "main",
          state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
          port: { number: fixture.port, leasedAt: 1_760_000_000_000 },
          service: declared,
        }),
      )
      if (fixture.run !== undefined)
        writeFileSync(join(rooms, fixture.id, "run.json"), JSON.stringify(fixture.run))
      writeFileSync(
        join(workstreams, fixture.id + ".json"),
        workstreamRecord({ id: fixture.id, path: worktree, label: fixture.id }),
      )
    }

    const output = await runAsync(["presence", "--json", "--root", "rooms"], root, {
      FACTORY_HOME: factoryHome,
    })
    expect(output.status, output.stderr).toBe(0)
    const presence = JSON.parse(output.stdout)
    const environments = new Map<string, { services: Array<unknown>; preview: string | null }>(
      presence.factory.environments.map((environment: { workstream: string }) => [
        environment.workstream,
        environment,
      ]),
    )
    expect(environments.get("answering")?.services).toEqual([
      {
        name: "web",
        command: "node server.js",
        port,
        healthPath: "/healthz",
        status: "healthy",
        detail: null,
        checkedAt: presence.observedAt,
      },
    ])
    expect(environments.get("idle")?.services).toEqual([
      {
        name: "web",
        command: "node server.js",
        port: port + 1,
        healthPath: "/healthz",
        status: "stopped",
        detail: "no supervisor is running for this room",
        checkedAt: presence.observedAt,
      },
    ])
    // Only the observed 2xx earns a route; the stopped service keeps a null preview even
    // though its lease names a port.
    expect(environments.get("answering")?.preview).toBe("/preview/answering/")
    expect(environments.get("idle")?.preview).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("board up routes a VM room preview through its supervisor socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-vm-preview-"))
  const roomRoot = join(root, "rooms")
  const room = "vm-preview"
  const worktree = join(roomRoot, room, "worktree")
  const factoryHome = join(root, "factory")
  const workstreams = join(factoryHome, "workstreams")
  mkdirSync(worktree, { recursive: true })
  mkdirSync(workstreams, { recursive: true })
  writeFileSync(
    join(roomRoot, room, "room.json"),
    JSON.stringify({
      id: room,
      base: "main",
      state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
      runtime: { kind: "agentos", previewPort: 5000 },
    }),
  )
  writeFileSync(
    join(workstreams, "vm-preview.json"),
    workstreamRecord({ id: "vm-preview", path: worktree, label: "vm-preview" }),
  )
  // A real Unix socket answers the same protocol the detached supervisor does. The board
  // resolves the workstream to the room, sees the guest port, and must reach the service
  // through vmHttp — not through a host port.
  const supervisor = createNetServer((socket) => {
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk: string) => {
      buffer += chunk
      if (!buffer.includes("\n")) return
      const request = JSON.parse(buffer) as { readonly path: string }
      socket.end(
        JSON.stringify({
          kind: "http",
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
          body: Buffer.from("vm preview " + request.path).toString("base64"),
        }) + "\n",
      )
    })
  })
  const socketPath = join(roomRoot, room, "vm.sock")
  await new Promise<void>((resolve, reject) => {
    supervisor.once("error", reject)
    supervisor.listen(socketPath, resolve)
  })
  const boardPort = await releasedPort()
  const up = run(["up", "--root", "rooms", "--port", String(boardPort), "--detach"], root, {
    FACTORY_HOME: factoryHome,
  })
  expect(up.status, up.stderr).toBe(0)
  try {
    const preview = await fetch(
      "http://127.0.0.1:" + boardPort + "/preview/vm-preview/assets/app.js?v=2",
    )
    expect(preview.status).toBe(200)
    expect(await preview.text()).toBe("vm preview /assets/app.js?v=2")
  } finally {
    run(["down", "--root", "rooms"], root)
    await new Promise<void>((resolve) => supervisor.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("board exposes room lifecycle to its loopback control plane", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-rooms-"))
  const repo = join(root, "repo")
  const factoryHome = join(root, "factory")
  mkdirSync(repo, { recursive: true })
  const git = (...args: ReadonlyArray<string>) =>
    spawnSync("git", args, { cwd: repo, stdio: "ignore" })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "room@example.test")
  git("config", "user.name", "Room Test")
  writeFileSync(join(repo, "README.md"), "room\n")
  git("add", "README.md")
  git("commit", "-q", "-m", "init")
  const boardPort = await releasedPort()
  const up = run(["up", "--root", "rooms", "--port", String(boardPort), "--detach"], root, {
    FACTORY_HOME: factoryHome,
  })
  expect(up.status, up.stderr).toBe(0)
  const origin = "http://127.0.0.1:" + boardPort
  try {
    const created = await fetch(origin + "/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "api-room", repo, scope: "api-room" }),
    })
    expect(created.status, await created.text()).toBe(200)

    const listed = await fetch(origin + "/rooms")
    expect(listed.status).toBe(200)
    const rooms = (await listed.json()) as { rooms: Array<{ id: string; state: string }> }
    expect(rooms.rooms).toContainEqual({ id: "api-room", state: "Ready" })

    for (const action of ["up", "pause", "resume", "down"]) {
      const response = await fetch(origin + "/rooms/api-room/" + action, { method: "POST" })
      expect(response.status, action + ": " + (await response.text())).toBe(200)
    }
    expect((await fetch(origin + "/rooms")).status).toBe(200)
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)

test("board up routes a workstream's preview to its room's leased service", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-preview-"))
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("path " + (request.url ?? "") + "\n")
  })
  try {
    // A chosen port rather than a read-back one: the address union is a representation this
    // test does not need to narrow, and the range is the same random one the other cases use.
    const servicePort = 20_000 + Math.floor(Math.random() * 20_000)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(servicePort, "127.0.0.1", resolve)
    })
    // Three rooms beside one another, because the route's two refusals are the claim as much as
    // its one answer: a service that answers, a room that declares none, and a declared service
    // nothing listens on. The rooms are not named after their workstreams, so the lease reaches
    // each record through the worktree alone.
    const service = { name: "web", command: "node server.js", healthPath: "/healthz" }
    const fixtures = [
      { room: "preview-room", workstream: "preview-probe", port: servicePort, service },
      { room: "silent-room", workstream: "preview-silent", port: servicePort, service: undefined },
      { room: "refusing-room", workstream: "preview-refused", port: await releasedPort(), service },
    ]
    const rooms = join(root, "rooms")
    const factoryHome = join(root, "factory")
    const workstreams = join(factoryHome, "workstreams")
    mkdirSync(workstreams, { recursive: true })
    for (const fixture of fixtures) {
      const worktree = join(rooms, fixture.room, "worktree")
      mkdirSync(worktree, { recursive: true })
      // A room that declares no service leaves the key out rather than naming an empty one.
      const record = {
        id: fixture.room,
        base: "main",
        state: { _tag: "Ready", repo: "/r", scope: "dev", createdAt: 1 },
        port: { number: fixture.port, leasedAt: 1_760_000_000_000 },
      }
      writeFileSync(
        join(rooms, fixture.room, "room.json"),
        JSON.stringify(
          fixture.service === undefined ? record : { ...record, service: fixture.service },
        ),
      )
      // A live supervisor is what lets a probe reach a socket at all: without a run record the
      // room reports `stopped` before any connection is attempted.
      writeFileSync(
        join(rooms, fixture.room, "run.json"),
        JSON.stringify({
          pid: process.pid,
          exec: "node server.js",
          startedAt: 1,
          log: "/tmp/room.log",
        }),
      )
      writeFileSync(
        join(workstreams, fixture.workstream + ".json"),
        workstreamRecord({
          id: fixture.workstream,
          path: worktree,
          label: fixture.workstream,
        }),
      )
    }

    const boardPort = 20_000 + Math.floor(Math.random() * 20_000)
    const up = run(["up", "--root", "rooms", "--port", String(boardPort), "--detach"], root, {
      FACTORY_HOME: factoryHome,
    })
    expect(up.status, up.stderr).toBe(0)
    try {
      const origin = "http://127.0.0.1:" + boardPort
      // Decode the served bytes rather than asserting their shape: the document is the seam.
      const { factory } = Schema.decodeUnknownSync(
        Schema.Struct({
          factory: Schema.Struct({
            environments: Schema.Array(
              Schema.Struct({
                workstream: Schema.String,
                preview: Schema.NullOr(Schema.String),
                services: Schema.Array(Schema.Struct({ status: Schema.String })),
              }),
            ),
          }),
        }),
      )(await (await fetch(origin + "/presence")).json())
      const environments = new Map(
        factory.environments.map((environment) => [environment.workstream, environment]),
      )
      // One route, for the one service a probe saw answer. A room that declares nothing serves
      // no service at all, and a service whose port refuses still has its observation — which
      // is exactly why neither advertises a preview.
      expect(environments.get("preview-probe")?.preview).toBe("/preview/preview-probe/")
      expect(environments.get("preview-probe")?.services.map((each) => each.status)).toEqual([
        "healthy",
      ])
      expect(environments.get("preview-silent")?.services).toEqual([])
      expect(environments.get("preview-silent")?.preview).toBeNull()
      expect(environments.get("preview-refused")?.services.map((each) => each.status)).toEqual([
        "unhealthy",
      ])
      expect(environments.get("preview-refused")?.preview).toBeNull()

      // The advertised route answers with the service's own bytes, path and query intact.
      const preview = await fetch(origin + "/preview/preview-probe/assets/app.js?v=2")
      expect(preview.status).toBe(200)
      expect(await preview.text()).toBe("path /assets/app.js?v=2\n")

      // A workstream whose room declares no service is refused here rather than forwarded to a
      // port the room does not own — even though a server happens to answer on that number.
      expect((await fetch(origin + "/preview/preview-silent/")).status).toBe(404)
      // A service that does not answer is a 502, never an empty 200 that looks like an answer.
      expect((await fetch(origin + "/preview/preview-refused/")).status).toBe(502)
      // A workstream no room holds is refused the same way.
      expect((await fetch(origin + "/preview/stranger/")).status).toBe(404)
    } finally {
      run(["down", "--root", "rooms"], root)
    }
  } finally {
    run(["down", "--root", "rooms"], root)
    rmSync(root, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 30_000)
