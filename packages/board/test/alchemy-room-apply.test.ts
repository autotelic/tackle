import { readVmStatus, stopVmSupervisor } from "@autotelic/room/VmSupervisor"
import { WorktreeLive } from "@autotelic/room/Worktree"
import * as Alchemy from "alchemy"
import * as Alchemist from "alchemy/Alchemist"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { Room, RoomMachine, roomProviders } from "../src/alchemy/Room.ts"

/**
 * The plan test proves the graph; this test proves the provider actually does what the graph
 * says. It creates one real room record and one real git worktree in a scratch directory, then
 * tears the scratch directory down. No VM and no supervisor are involved.
 */

const scratch = (): { cwd: string; repo: string; root: string } => {
  const cwd = mkdtempSync(join(tmpdir(), "room-apply-"))
  const repo = join(cwd, "repo")
  mkdirSync(repo, { recursive: true })
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "room@example.test")
  git("config", "user.name", "Room Test")
  writeFileSync(join(repo, "README.md"), "room\n")
  git("add", "README.md")
  git("commit", "-q", "-m", "init")
  return { cwd, repo, root: join(cwd, "rooms") }
}

test("applying the room resource creates the record and its worktree", async () => {
  const { cwd, repo, root } = scratch()
  try {
    const stack = Alchemy.Stack(
      "room-apply",
      {
        providers: roomProviders().pipe(Layer.provide(WorktreeLive)),
        state: Alchemy.inMemoryState(),
      },
      Effect.gen(function* () {
        return yield* Room("alpha", { id: "alpha", root, repo, base: "main", scope: "alpha" })
      }),
    )
    const plan = await Effect.runPromise(
      Effect.scoped(Alchemist.plan({ stack, operation: "deploy", stage: "test" })).pipe(
        Effect.provide(Alchemist.layer()),
      ),
    )
    await Effect.runPromise(Alchemist.apply(plan))

    expect(existsSync(join(root, "alpha", "room.json"))).toBe(true)
    expect(existsSync(join(root, "alpha", "worktree", "README.md"))).toBe(true)
    expect(existsSync(join(root, "alpha", "worktree", ".git"))).toBe(true)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}, 120_000)

test("applying the machine resource starts the room's VM supervisor", async () => {
  const { cwd, repo, root } = scratch()
  try {
    const stack = Alchemy.Stack(
      "room-machine-apply",
      {
        providers: roomProviders().pipe(Layer.provide(WorktreeLive)),
        state: Alchemy.inMemoryState(),
      },
      Effect.gen(function* () {
        const room = yield* Room("alpha", {
          id: "alpha",
          root,
          repo,
          base: "main",
          scope: "alpha",
        })
        return yield* RoomMachine("alpha-vm", {
          room: room.id,
          root,
          stateDir: join(root, "alpha"),
        })
      }),
    )
    const plan = await Effect.runPromise(
      Effect.scoped(Alchemist.plan({ stack, operation: "deploy", stage: "test" })).pipe(
        Effect.provide(Alchemist.layer()),
      ),
    )
    await Effect.runPromise(Alchemist.apply(plan))

    const status = await readVmStatus({ root, id: "alpha" })
    expect(status.state).toBe("running")
    expect(status.run?.socket).toBe(join(root, "alpha", "vm.sock"))
  } finally {
    await stopVmSupervisor({ root, id: "alpha" }).catch(() => undefined)
    await rm(cwd, { recursive: true, force: true })
  }
}, 120_000)
