/* oxlint-disable plumb/prefer-property-tests -- one real board, one real room and one real VM; the endpoint is the assertion. */
import { WorktreeLive } from "@autotelic/room/Worktree"
import * as Alchemy from "alchemy"
import * as Alchemist from "alchemy/Alchemist"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { Room, RoomMachine, roomProviders } from "../src/alchemy/Room.ts"

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

const repository = (root: string): string => {
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  const git = (...args: ReadonlyArray<string>) => spawnSync("git", args, { cwd: repo })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "room@example.test")
  git("config", "user.name", "Room Test")
  writeFileSync(join(repo, "README.md"), "room\n")
  git("add", "README.md")
  git("commit", "-q", "-m", "init")
  return repo
}

test("Alchemy creates a room and starts its VM through board", async () => {
  // Short: the VM supervisor binds a Unix socket below the room directory, and macOS caps that path.
  const scratch = mkdtempSync(join(tmpdir(), "abr-"))
  const root = join(scratch, "rooms")
  const factoryHome = join(scratch, "factory")
  const repo = repository(scratch)
  const port = 20_000 + Math.floor(Math.random() * 20_000)
  const up = run(["up", "--root", "rooms", "--port", String(port), "--detach"], scratch, {
    FACTORY_HOME: factoryHome,
  })
  expect(up.status, up.stderr).toBe(0)
  const board = "http://127.0.0.1:" + port
  try {
    const stack = Alchemy.Stack(
      "board-room",
      {
        providers: roomProviders().pipe(Layer.provide(WorktreeLive)),
        state: Alchemy.inMemoryState(),
      },
      Effect.gen(function* () {
        const room = yield* Room("api-alpha", {
          id: "api-alpha",
          root,
          repo,
          base: "main",
          scope: "api-alpha",
          board,
        })
        return yield* RoomMachine("api-alpha-vm", {
          room: room.id,
          root,
          stateDir: join(root, "api-alpha"),
          board,
        })
      }),
    )
    const plan = await Effect.runPromise(
      Effect.scoped(Alchemist.plan({ stack, operation: "deploy", stage: "test" })).pipe(
        Effect.provide(Alchemist.layer()),
      ),
    )
    await Effect.runPromise(Alchemist.apply(plan))

    const rooms = (await (await fetch(board + "/rooms")).json()) as {
      rooms: Array<{ id: string; vm: { state: string }; session: { state: string } }>
    }
    const created = rooms.rooms.find((entry) => entry.id === "api-alpha")
    expect(created?.vm.state).toBe("running")
    expect(created?.session.state).toBe("durable")
  } finally {
    await fetch(board + "/rooms/api-alpha/down", { method: "POST" }).catch(() => undefined)
    run(["down", "--root", "rooms"], scratch)
    rmSync(scratch, { recursive: true, force: true })
  }
}, 120_000)
