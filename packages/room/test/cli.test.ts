import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { readRoom } from "../src/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- the subject is the printed sentence over one scratch repository. */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))

const git = (cwd: string, ...args: ReadonlyArray<string>): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

/** A committed repository so `git worktree add` has a base to branch from. */
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

const room = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
  })

const roomWithEnv = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>,
) =>
  spawnSync(process.execPath, ["--conditions=development", cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "room-cli-"))
  return { root, close: () => rmSync(root, { recursive: true, force: true }) }
}

describe("a verb that prints a completion is a claim", () => {
  it("says pause recorded state and signalled nothing", () => {
    const { root, close } = scratch()
    try {
      const created = room(root, "new", "--repo", repository(root), "--scope", "dev")
      expect(created.status).toBe(0)
      const paused = room(root, "pause", "--id", "dev-repo")
      expect(paused.status).toBe(0)
      expect(paused.stdout).toContain("journal ")
      expect(paused.stdout).toContain("checkpointed; no process was signalled")
    } finally {
      close()
    }
  })

  it("says resume recorded state and started nothing", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      expect(room(root, "pause", "--id", "dev-repo").status).toBe(0)
      const resumed = room(root, "resume", "--id", "dev-repo")
      expect(resumed.status).toBe(0)
      expect(resumed.stdout).toContain("journal ")
      expect(resumed.stdout).toContain("reopened; no process was continued")
    } finally {
      close()
    }
  })

  it("refuses move instead of recording a move that does not happen", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const moved = room(root, "move", "--id", "dev-repo", "--to", "mini")
      expect(moved.status).toBe(1)
      expect(moved.stdout).toBe("")
      expect(moved.stderr).toContain(
        "move is not implemented; refusing to record a move that does not happen",
      )
    } finally {
      close()
    }
  })

  it("leases one port on up, keeps it across pause and resume, and releases it on down", async () => {
    const { root, close } = scratch()
    const shop = join(root, ".room")
    const leaseOf = async () => (await readRoom({ root: shop, id: "dev-repo" }))?.port
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const up = room(root, "up", "--id", "dev-repo")
      expect(up.status).toBe(0)
      expect(up.stdout).toContain("port 4400")
      expect(await leaseOf()).toEqual({ number: 4400, leasedAt: expect.any(Number) })
      expect(room(root, "status", "--id", "dev-repo").stdout).toContain("port 4400")
      // A frozen room still owns its port: pause and resume change the process, not the lease.
      expect(room(root, "pause", "--id", "dev-repo").status).toBe(0)
      expect((await leaseOf())?.number).toBe(4400)
      expect(room(root, "resume", "--id", "dev-repo").status).toBe(0)
      const down = room(root, "down", "--id", "dev-repo")
      expect(down.status).toBe(0)
      expect(down.stdout).toContain("released port 4400")
      expect(await leaseOf()).toBeUndefined()
      expect(existsSync(join(shop, "ports", "4400.json"))).toBe(false)
      // A second down has nothing to release, so it refuses instead of claiming a stop.
      expect(room(root, "down", "--id", "dev-repo").status).toBe(1)
    } finally {
      close()
    }
  }, 30_000)

  it("runs a command, freezes it on pause, continues it on resume, and stops it on down", async () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const up = room(
        root,
        "up",
        "--id",
        "dev-repo",
        "--exec",
        "while true; do echo tick >> ticks; sleep 0.1; done",
      )
      expect(up.status).toBe(0)
      expect(up.stdout).toContain("room dev-repo up; supervisor ")

      const ticks = join(root, ".room", "dev-repo", "worktree", "ticks")
      const count = (): number =>
        existsSync(ticks) ? readFileSync(ticks, "utf8").split("\n").length : 0
      await new Promise((resolve) => setTimeout(resolve, 400))
      const beforePause = count()
      expect(beforePause).toBeGreaterThan(0)
      expect(room(root, "pause", "--id", "dev-repo").stdout).toContain(
        "checkpointed; process group was signalled",
      )
      // The state write happens before the signal; let those last ticks land, then freeze is proven.
      await new Promise((resolve) => setTimeout(resolve, 250))
      const pausedCount = count()
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(count()).toBe(pausedCount)
      expect(room(root, "resume", "--id", "dev-repo").stdout).toContain(
        "reopened; process group was continued",
      )
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(count()).toBeGreaterThan(pausedCount)
      const down = room(root, "down", "--id", "dev-repo")
      expect(down.status).toBe(0)
      expect(down.stdout).toContain("stopped")
      const again = room(root, "up", "--id", "dev-repo")
      expect(again.status).toBe(0)
      expect(again.stdout).toContain("room dev-repo up; supervisor ")
      expect(room(root, "down", "--id", "dev-repo").status).toBe(0)
    } finally {
      room(root, "down", "--id", "dev-repo")
      close()
    }
  }, 30_000)

  it("attaches an existing PR branch instead of minting room/<branch>", () => {
    const { root, close } = scratch()
    try {
      const repo = repository(root)
      git(repo, "checkout", "-q", "-b", "feature/pr")
      writeFileSync(join(repo, "PR.md"), "pr\n")
      git(repo, "add", "PR.md")
      git(repo, "commit", "-q", "-m", "pr")
      git(repo, "checkout", "-q", "main")
      const created = room(root, "new", "--repo", repo, "--scope", "pr", "--branch", "feature/pr")
      expect(created.status).toBe(0)
      const worktree = join(root, ".room", "pr-repo", "worktree")
      expect(
        execFileSync("git", ["branch", "--show-current"], {
          cwd: worktree,
          encoding: "utf8",
        }).trim(),
      ).toBe("feature/pr")
      expect(
        JSON.parse(readFileSync(join(root, ".room", "pr-repo", "room.json"), "utf8")).base,
      ).toBe("feature/pr")
    } finally {
      close()
    }
  })

  it("binds an existing child worktree instead of creating a third", () => {
    const { root, close } = scratch()
    try {
      const repo = repository(root)
      const external = join(root, "child-worktree")
      git(repo, "worktree", "add", "-b", "child", external, "main")
      const created = room(root, "new", "--repo", repo, "--scope", "bound", "--worktree", external)
      expect(created.status).toBe(0)
      expect(created.stdout).toContain("room bound-repo ready")
      const link = join(root, ".room", "bound-repo", "worktree")
      expect(readFileSync(join(link, "README.md"), "utf8")).toBe("room\n")
      expect(existsSync(join(root, ".room", "bound-repo", "room.json"))).toBe(true)
    } finally {
      close()
    }
  })

  it("labels this Herdr terminal only when asked", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const bin = join(root, "bin")
      mkdirSync(bin, { recursive: true })
      const hc = join(bin, "hc")
      writeFileSync(hc, '#!/bin/sh\necho "$@" >> "$HC_LOG"\nexit 0\n')
      chmodSync(hc, 0o755)
      const log = join(root, "hc.log")
      const used = roomWithEnv(root, ["use", "--id", "dev-repo"], {
        HC_TERMINAL_ID: "t1",
        HC_LOG: log,
        PATH: bin + ":" + (process.env.PATH ?? ""),
      })
      expect(used.status).toBe(0)
      expect(used.stdout).toBe("room dev-repo labels terminal t1\n")
      expect(readFileSync(log, "utf8")).toBe("get t1 --json\nlabel t1 room=dev-repo\n")
    } finally {
      close()
    }
  })

  it("stamps room= on a child at spawn", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const bin = join(root, "bin")
      mkdirSync(bin, { recursive: true })
      const hc = join(bin, "hc")
      writeFileSync(hc, '#!/bin/sh\necho "$@" >> "$HC_LOG"\nexit 0\n')
      chmodSync(hc, 0o755)
      const log = join(root, "hc-run.log")
      const spawned = roomWithEnv(root, ["run", "--id", "dev-repo", "--", "echo", "hi"], {
        HC_LOG: log,
        PATH: bin + ":" + (process.env.PATH ?? ""),
      })
      expect(spawned.status).toBe(0)
      const line = readFileSync(log, "utf8").trim()
      expect(line).toContain("run --label room=dev-repo --cwd ")
      expect(line).toContain("-- echo hi")
    } finally {
      close()
    }
  })

  it("hands `run` a journal the child reopens by request id", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const bin = join(root, "bin")
      mkdirSync(bin, { recursive: true })
      const hc = join(bin, "hc")
      // The real `hc` runs the command after `--` in `--cwd`; this stand-in does the same so the
      // test exercises `room run`'s environment rather than hc's own behaviour.
      writeFileSync(hc, '#!/bin/sh\ncwd="$5"\nshift 6\ncd "$cwd" || exit 1\nexec "$@"\n')
      chmodSync(hc, 0o755)
      const child = join(root, "journal-child.mjs")
      const roomModule = pathToFileURL(
        fileURLToPath(new URL("../src/RoomSession.ts", import.meta.url)),
      ).href
      const require = createRequire(import.meta.url)
      const chordContext = pathToFileURL(
        join(
          dirname(require.resolve("@earendil-works/chord/package.json")),
          "dist",
          "context",
          "index.js",
        ),
      ).href
      writeFileSync(
        child,
        [
          'import { BACKGROUND_CONTEXT } from "' + chordContext + '"',
          'import { openRoomSessionFromEnvironment } from "' + roomModule + '"',
          "",
          "const journal = await openRoomSessionFromEnvironment()",
          "const conversation = await journal.session.commit(async (tx) => {",
          "  const page = await tx.scanConversations({}, 1)",
          '  return page.items[0] ?? (await tx.createConversation({ ownership: { kind: "ownerless" } }))',
          "}, BACKGROUND_CONTEXT)",
          "const outcome = await journal.write({",
          "  conversationId: conversation.id,",
          '  requestId: "run-once",',
          '  entry: { kind: "room.test", data: { note: process.argv[2] ?? "" } },',
          "})",
          'console.log(outcome.status + " " + outcome.entryId + " " + journal.path)',
          "await journal.close()",
        ].join("\n") + "\n",
      )
      const environment = { HC_BIN: hc }
      const first = roomWithEnv(
        root,
        ["run", "--id", "dev-repo", "--", process.execPath, child, "first"],
        environment,
      )
      expect(first.status).toBe(0)
      const [firstStatus, firstEntry, firstPath] = first.stdout.trim().split(" ")
      expect(firstStatus).toBe("admitted")
      expect(firstPath).toBe(realpathSync(join(root, ".room", "dev-repo", "session.sqlite")))

      const second = roomWithEnv(
        root,
        ["run", "--id", "dev-repo", "--", process.execPath, child, "second"],
        environment,
      )
      expect(second.status).toBe(0)
      const [secondStatus, secondEntry] = second.stdout.trim().split(" ")
      expect(secondStatus).toBe("existing")
      expect(secondEntry).toBe(firstEntry)
    } finally {
      close()
    }
  })

  it("refuses to label when HC_TERMINAL_ID is absent", () => {
    const { root, close } = scratch()
    try {
      expect(room(root, "new", "--repo", repository(root), "--scope", "dev").status).toBe(0)
      const used = roomWithEnv(root, ["use", "--id", "dev-repo"], { HC_TERMINAL_ID: "" })
      expect(used.status).toBe(1)
      expect(used.stderr).toContain("use needs HC_TERMINAL_ID")
    } finally {
      close()
    }
  })

  it("runs two rooms with separate worktrees, ports, and services", async () => {
    const { root, close } = scratch()
    const repo = repository(root)
    const server = join(repo, "server.mjs")
    writeFileSync(
      server,
      'import { createServer } from "node:http"\nimport { readFileSync } from "node:fs"\nconst who = readFileSync("who.txt", "utf8").trim()\ncreateServer((request, response) => response.end(who + " " + request.url)).listen(process.env.PORT)\n',
    )
    git(repo, "add", "server.mjs")
    git(repo, "commit", "-q", "-m", "server")
    try {
      expect(room(root, "new", "--repo", repo, "--scope", "perms").status).toBe(0)
      expect(room(root, "new", "--repo", repo, "--scope", "qa").status).toBe(0)
      const perms = join(root, ".room", "perms-repo", "worktree")
      const qa = join(root, ".room", "qa-repo", "worktree")
      writeFileSync(join(perms, "who.txt"), "perms\n")
      writeFileSync(join(qa, "who.txt"), "qa\n")

      for (const id of ["perms-repo", "qa-repo"]) {
        const up = room(
          root,
          "up",
          "--id",
          id,
          "--service",
          "web",
          "--health",
          "/healthz",
          "--exec",
          "node server.mjs",
        )
        expect(up.status).toBe(0)
      }
      const permsStatus = room(root, "status", "--id", "perms-repo")
      const qaStatus = room(root, "status", "--id", "qa-repo")
      expect(permsStatus.stdout).toContain("port 4400")
      expect(qaStatus.stdout).toContain("port 4401")
      expect(permsStatus.stdout).toContain("service web healthy")
      expect(qaStatus.stdout).toContain("service web healthy")
      expect(readFileSync(join(perms, "who.txt"), "utf8")).toBe("perms\n")
      expect(readFileSync(join(qa, "who.txt"), "utf8")).toBe("qa\n")
    } finally {
      room(root, "down", "--id", "perms-repo")
      room(root, "down", "--id", "qa-repo")
      close()
    }
  }, 30_000)
})
