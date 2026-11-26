/* oxlint-disable plumb/prefer-property-tests -- real sidecar processes over fixed temp worktrees; the assertion is isolation. */
import { Effect } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { createAgentOsRoom, runAgentOsCommand } from "../src/AgentOs.ts"

const create = (id: string) => Effect.runPromise(createAgentOsRoom({ id }))

/** A host directory standing in for one room's checkout, plus the room's state directory. */
const scratchWorktree = async (label: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "room-agentos-" + label + "-"))
  await writeFile(join(dir, "who.txt"), label + "\n")
  return dir
}

/** The VM's state directory is the room's own directory, never the mounted worktree. */
const stateDirOf = (label: string): Promise<string> =>
  mkdtemp(join(tmpdir(), "room-agentos-state-" + label + "-"))

test("two embedded agentOS rooms have separate filesystems and processes", async () => {
  const a = await create("permissions-dog")
  const b = await create("enterprise-dog")
  try {
    await a.vm.filesystem.writeFile("/workspace/who.txt", "permissions\n")
    await b.vm.filesystem.writeFile("/workspace/who.txt", "enterprise\n")

    const readA = await a.vm.process.exec("cat /workspace/who.txt", {
      output: { capture: "all" },
    })
    const readB = await b.vm.process.exec("cat /workspace/who.txt", {
      output: { capture: "all" },
    })
    expect(readA.stdout).toBe("permissions\n")
    expect(readB.stdout).toBe("enterprise\n")

    await a.vm.filesystem.writeFile("/workspace/only-a.txt", "a\n")
    expect(await a.vm.filesystem.exists("/workspace/only-a.txt")).toBe(true)
    expect(await b.vm.filesystem.exists("/workspace/only-a.txt")).toBe(false)
  } finally {
    await a.dispose()
    await b.dispose()
  }
}, 60_000)

test("two VMs mounted over separate worktrees cannot read each other's files", async () => {
  const left = await scratchWorktree("left")
  const right = await scratchWorktree("right")
  const leftState = await stateDirOf("left")
  const rightState = await stateDirOf("right")
  const a = await Effect.runPromise(
    createAgentOsRoom({ id: "left", worktree: left, stateDir: leftState }),
  )
  const b = await Effect.runPromise(
    createAgentOsRoom({ id: "right", worktree: right, stateDir: rightState }),
  )
  try {
    await writeFile(join(left, "only-left.txt"), "left\n")

    const own = await a.vm.process.exec("cat /workspace/who.txt", { output: { capture: "all" } })
    expect(own.exitCode).toBe(0)
    expect(own.stdout).toBe("left\n")

    // The other room's file is not merely absent from this worktree: the guest cannot reach
    // the other mount at all, so the read fails rather than answering with the wrong tree.
    const foreign = await b.vm.process.exec("cat /workspace/only-left.txt", {
      output: { capture: "all" },
    })
    expect(foreign.exitCode).not.toBe(0)
    expect(foreign.stdout).toBe("")
    expect(foreign.stderr).not.toBe("")

    // And the reverse direction: what each VM sees under /workspace is its own worktree.
    const rightWho = await b.vm.process.exec("cat /workspace/who.txt", {
      output: { capture: "all" },
    })
    expect(rightWho.stdout).toBe("right\n")
  } finally {
    await a.dispose()
    await b.dispose()
    await rm(left, { recursive: true, force: true })
    await rm(right, { recursive: true, force: true })
    await rm(leftState, { recursive: true, force: true })
    await rm(rightState, { recursive: true, force: true })
  }
}, 60_000)

test("a VM write reaches its own host worktree", async () => {
  const worktree = await scratchWorktree("writer")
  const stateDir = await stateDirOf("writer")
  const room = await Effect.runPromise(createAgentOsRoom({ id: "writer", worktree, stateDir }))
  try {
    await room.vm.filesystem.writeFile("/workspace/written.txt", "from the guest\n")
    expect(await readFile(join(worktree, "written.txt"), "utf8")).toBe("from the guest\n")

    // A command's own write lands in the room's checkout too, not in a private copy of it.
    const ran = await Effect.runPromise(
      runAgentOsCommand({
        id: "writer",
        worktree,
        stateDir,
        command: "sh",
        args: ["-c", "echo ran > /workspace/ran.txt"],
      }),
    )
    expect(ran.exitCode).toBe(0)
    expect(ran.outcome).toBe("succeeded")
    expect(await readFile(join(worktree, "ran.txt"), "utf8")).toBe("ran\n")
  } finally {
    await room.dispose()
    await rm(worktree, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
}, 60_000)
