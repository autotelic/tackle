/* oxlint-disable plumb/prefer-property-tests -- one real agentOS VM over a scratch room plus two pure decodes; the assertion is what the guest and the record actually report. */
import { Effect } from "effect"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { createAgentOsRoom } from "../src/AgentOs.ts"
import { createRoom, readRoom, roomFile, roomSoftware } from "../src/store.ts"
import { defaultRoomSoftware, softwareReport } from "../src/VmSoftware.ts"

/*
 * The registry is the requirement, not the fixture: `git` is the one tool of the three a room
 * needs that the agentOS release manifest publishes (ADR 0006), so a boot that declares it
 * resolves it from https://releases.rivet.dev/agent-os/ (or AGENTOS_SOFTWARE_REGISTRY_URL).
 * A machine without that registry fails here instead of passing on a skipped VM.
 */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

/** A room made by the CLI over a scratch checkout, so nothing here re-creates the store. */
interface Scratch {
  readonly cwd: string
  /** The `.room` root: where `room.json` and the VM's own record live. */
  readonly root: string
  readonly id: string
  readonly stateDir: string
  readonly close: () => Promise<void>
}

const roomCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], { cwd, encoding: "utf8" })

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

/**
 * A room that declares its software, made the way an operator would make one.
 *
 * The declaration travels the boundary under test: argv on `room new`, the room file, and the
 * supervisor that reads it before booting the VM.
 */
const scratchRoom = (label: string, software: string): Scratch => {
  // Short on purpose: a Unix socket path is capped near 104 bytes on macOS, and this
  // scratch directory holds `.room/<id>/vm.sock` below it.
  const cwd = mkdtempSync(join(tmpdir(), "sw-" + label + "-"))
  const created = roomCli(
    cwd,
    "new",
    "--repo",
    repository(cwd),
    "--scope",
    label,
    "--id",
    label,
    "--software",
    software,
  )
  if (created.status !== 0) throw new Error("room new failed: " + created.stderr)
  return {
    cwd,
    root: join(cwd, ".room"),
    id: label,
    stateDir: join(cwd, ".room", label),
    close: () => rm(cwd, { recursive: true, force: true }),
  }
}

/** Run one command in the room's VM, surfacing the supervisor log when it fails. */
const guest = (room: Scratch, command: ReadonlyArray<string>) => {
  const ran = roomCli(room.cwd, "vm", "--id", room.id, "--", ...command)
  if (ran.status === 0) return ran
  const log = join(room.stateDir, "vm.log")
  return {
    ...ran,
    stderr: ran.stderr + (existsSync(log) ? "\n--- vm.log ---\n" + readFileSync(log, "utf8") : ""),
  }
}

test("a room file written before the declaration still decodes to the default", async () => {
  const root = mkdtempSync(join(tmpdir(), "sw-absent-"))
  try {
    const created = await createRoom({
      root,
      id: "absent",
      repo: "repo",
      scope: "absent",
      base: "main",
      at: Date.now(),
    })
    if (!created.ok) throw new Error("createRoom refused: " + created.error)
    // A room made today names its software in its own file, so the guest can be read without a
    // VM: the boundary declares, it does not inherit.
    expect(created.value.software).toEqual(defaultRoomSoftware)
    expect(defaultRoomSoftware.packages).toContain("git")

    // An older room file has no field at all. Reading it must not fail, and the declaration it
    // implies is the default rather than a bare VM.
    const file = roomFile({ root, id: "absent" })
    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
    delete written.software
    await writeFile(file, JSON.stringify(written, null, 2) + "\n")

    const room = await readRoom({ root, id: "absent" })
    expect(room?.software).toBeUndefined()
    expect(roomSoftware(room)).toEqual(defaultRoomSoftware)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a declared package the VM does not report is visible as missing", () => {
  // The declaration is the room's claim; `installed` is the VM's answer. A package the VM does
  // not list is named here, so a Core release that drops one is a finding in the record and not
  // a later `command not found` in a pass.
  const report = softwareReport({ packages: ["git", "pnpm"] }, [
    { packageName: "git", version: "2.45.2", commands: ["git"] },
  ])
  expect(report.declared).toEqual(["git", "pnpm"])
  expect(report.installed).toEqual([{ name: "git", version: "2.45.2", commands: ["git"] }])
  expect(report.missing).toEqual(["pnpm"])
})

test("a declared room's guest has git and records what the VM installed", async () => {
  const room = scratchRoom("git", "git")
  try {
    const ran = guest(room, ["git", "--version"])
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toContain("git version")

    const record = await readRoom({ root: room.root, id: room.id })
    const software = record?.runtime?.software
    if (software === undefined)
      throw new Error("the boot recorded no software: " + JSON.stringify(record?.runtime))
    expect(software.declared).toEqual(["git"])
    const installed = software.installed.find((pkg) => pkg.name === "git")
    if (installed === undefined)
      throw new Error("the VM did not report git: " + JSON.stringify(software))
    // The version is the VM's, so it is asserted as present rather than pinned: what matters is
    // that the record names the package the declaration asked for.
    expect(installed.version).not.toBe("")
    expect(installed.commands).toContain("git")
    expect(software.missing).toEqual([])
  } finally {
    await room.close()
  }
}, 180_000)

test("a bare VM still runs the software its room declares", async () => {
  const room = await Effect.runPromise(
    createAgentOsRoom({
      id: "bare",
      software: { packages: ["git"] },
      // No Core default bundle in this VM: only the declared packages are installed, so the one
      // command that can answer is the one the room asked for.
      defaultSoftware: false,
    }),
  )
  try {
    const ran = await room.vm.process.execFile("git", ["--version"], {
      cwd: room.workspace,
      output: { capture: "all" },
    })
    expect(ran.stdout ?? "").toContain("git version")
    expect(room.software.declared).toEqual(["git"])
    expect(room.software.installed.map((pkg) => pkg.name)).toContain("git")
    expect(room.software.missing).toEqual([])
  } finally {
    await room.dispose()
  }
}, 180_000)
