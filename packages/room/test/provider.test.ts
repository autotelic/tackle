/* oxlint-disable plumb/prefer-property-tests -- provider tests use real git and filesystem fixtures. */
import { expect, test } from "vitest"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  agentOsRoomProvider,
  localRoomProvider,
  ProviderError,
  selectRoomProvider,
  type AgentOsClient,
} from "../src/Provider.ts"
import { Worktree, WorktreeLive } from "../src/Worktree.ts"

const run = promisify(execFile)

const project = async () => {
  const root = await mkdtemp(join(tmpdir(), "room-provider-"))
  const repo = join(root, "repo")
  await run("git", ["init", "-q", "-b", "main", repo])
  await writeFile(join(repo, "README.md"), "room\n")
  await run("git", ["-C", repo, "add", "README.md"])
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.email=room@example.com",
    "-c",
    "user.name=Room",
    "commit",
    "-qm",
    "init",
  ])
  return { root, repo }
}

test("the local provider places a room at its worktree", async () => {
  const { root, repo } = await project()
  try {
    const path = await Effect.runPromise(
      Effect.gen(function* () {
        const trees = yield* Worktree
        return yield* localRoomProvider(trees).ensure({
          id: "room-a",
          root,
          repo,
          base: "main",
        })
      }).pipe(Effect.provide(WorktreeLive)),
    )
    expect(path).toBe(join(root, "room-a", "worktree"))
    expect(await readFile(join(path, "README.md"), "utf8")).toBe("room\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the agentOS provider clones into its room VM", async () => {
  const calls: Array<unknown> = []
  const client: AgentOsClient = {
    agentOS: {
      getOrCreate: (key) => {
        expect(key).toEqual(["rooms", "room-a"])
        return {
          process: {
            run: async (input) => {
              calls.push(input)
              return { status: { exitCode: 0 }, stdout: "", stderr: "" }
            },
          },
        }
      },
    },
  }
  const path = await Effect.runPromise(
    agentOsRoomProvider(client).ensure({
      id: "room-a",
      root: "/tmp/unused",
      repo: "https://github.com/autotelic/tackle.git",
      base: "main",
    }),
  )
  expect(path).toBe("/workspace")
  expect(calls).toEqual([
    {
      command: "git",
      args: [
        "clone",
        "--branch",
        "main",
        "--single-branch",
        "https://github.com/autotelic/tackle.git",
        "/workspace",
      ],
      options: { cwd: "/", captureStdio: true },
    },
  ])
})

test("an agentOS clone failure is a ProviderError, not a raw exception", async () => {
  const client: AgentOsClient = {
    agentOS: {
      getOrCreate: () => ({
        process: {
          run: async () => ({
            status: { exitCode: 128 },
            stdout: "",
            stderr: "repository not found",
          }),
        },
      }),
    },
  }
  await expect(
    Effect.runPromise(
      agentOsRoomProvider(client).ensure({
        id: "room-a",
        root: "/tmp/unused",
        repo: "https://github.com/autotelic/missing.git",
        base: "main",
      }),
    ),
  ).rejects.toBeInstanceOf(ProviderError)
})

test("the provider selection falls back to local without an agentOS client", async () => {
  const { root, repo } = await project()
  try {
    const provider = await Effect.runPromise(
      Effect.gen(function* () {
        const trees = yield* Worktree
        return selectRoomProvider({ trees })
      }).pipe(Effect.provide(WorktreeLive)),
    )
    expect(provider.kind).toBe("local")
    expect(repo).toContain(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
