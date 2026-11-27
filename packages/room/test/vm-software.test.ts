/* oxlint-disable plumb/prefer-property-tests -- one real agentOS VM over a scratch room plus pure decodes; the assertion is what the guest and the record actually report. */
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
import { defaultRoomSoftware, softwareInputs, softwareReport } from "../src/VmSoftware.ts"

/*
 * The default declaration is empty on purpose (ADR 0006): a registry package is downloaded on
 * the host before the VM resolves, so defaulting to git would make every room boot depend on
 * releases.rivet.dev. The declaration path is covered through the room file and softwareInputs;
 * the boot test records the Core bundle the VM actually installed.
 */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

interface Scratch {
  readonly cwd: string
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

const scratchRoom = (label: string, software?: string): Scratch => {
  // Short on purpose: a Unix socket path is capped near 104 bytes on macOS.
  const cwd = mkdtempSync(join(tmpdir(), "sw-" + label + "-"))
  const args = ["new", "--repo", repository(cwd), "--scope", label, "--id", label]
  if (software !== undefined) args.push("--software", software)
  const created = roomCli(cwd, ...args)
  if (created.status !== 0) throw new Error("room new failed: " + created.stderr)
  return {
    cwd,
    root: join(cwd, ".room"),
    id: label,
    stateDir: join(cwd, ".room", label),
    close: () => rm(cwd, { recursive: true, force: true }),
  }
}

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
    // A room made today names its software in its own file, even when that declaration is empty.
    expect(created.value.software).toEqual(defaultRoomSoftware)
    expect(defaultRoomSoftware.packages).toEqual([])

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

test("a room declaration becomes the registry entries the VM receives", () => {
  expect(softwareInputs({ packages: ["git", "jq"] })).toEqual([
    { registry: "git" },
    { registry: "jq" },
  ])
  // Empty is the default, and it installs nothing beyond Core's own bundle.
  expect(softwareInputs(defaultRoomSoftware)).toEqual([])
})

test("a declared package the VM does not report is visible as missing", () => {
  // The declaration is the room's claim; installed is the VM's answer. A package the VM does
  // not list is named here, so a Core release that drops one is a finding in the record and not
  // a later command not found in a pass.
  const report = softwareReport({ packages: ["git", "pnpm"] }, [
    { packageName: "git", version: "2.45.2", commands: ["git"] },
  ])
  expect(report.declared).toEqual(["git", "pnpm"])
  expect(report.installed).toEqual([{ name: "git", version: "2.45.2", commands: ["git"] }])
  expect(report.missing).toEqual(["pnpm"])
})

test("a default room records its empty declaration without inventing packages", async () => {
  const room = scratchRoom("default")
  try {
    const ran = guest(room, ["sh", "-c", "echo ok"])
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toBe("ok\n")

    const record = await readRoom({ root: room.root, id: room.id })
    const software = record?.runtime?.software
    if (software === undefined)
      throw new Error("the boot recorded no software: " + JSON.stringify(record?.runtime))
    expect(software.declared).toEqual([])
    expect(software.missing).toEqual([])
    // installed() reports the packages this boot added; Core's vendored bundle is not in that
    // list. The record echoes the VM's answer rather than filling the bundle in from a guess.
    expect(software.installed).toEqual([])
  } finally {
    await room.close()
  }
}, 180_000)

test("a bare VM with an empty declaration can still run node", async () => {
  const room = await Effect.runPromise(
    createAgentOsRoom({
      id: "bare",
      software: { packages: [] },
      // No Core default bundle in this VM: only the declared packages (none) are installed.
      defaultSoftware: false,
    }),
  )
  try {
    const ran = await room.vm.process.execFile("node", ["-e", "console.log('bare')"], {
      cwd: room.workspace,
      output: { capture: "all" },
    })
    expect(ran.stdout ?? "").toContain("bare")
    expect(room.software.declared).toEqual([])
    expect(room.software.missing).toEqual([])
  } finally {
    await room.dispose()
  }
}, 180_000)
