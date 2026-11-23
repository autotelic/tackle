import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { adopt } from "../src/factory/adopt.ts"
import { appendEvent, readEvents } from "../src/factory/events.ts"
import { runPass } from "../src/factory/kernel.ts"
import { readWorkstream } from "../src/factory/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- fixed scratch repo and fixed fake worker. */

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "factory-kernel-"))
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  git(repo, "remote", "add", "origin", "https://github.com/acme/app.git")

  const gh = join(root, "gh")
  writeFileSync(
    gh,
    [
      "#!/bin/sh",
      "head=$(git rev-parse HEAD)",
      "branch=$(git rev-parse --abbrev-ref HEAD)",
      "pr=$3",
      'printf \'{"number":%s,"headRefName":"%s","headRefOid":"%s","baseRefName":"main","baseRefOid":"%s","url":"https://github.com/acme/app/pull/%s"}\' "$pr" "$branch" "$head" "$(git rev-parse main)" "$pr"',
      "",
    ].join("\n"),
  )
  chmodSync(gh, 0o755)
  process.env.GH_BIN = gh
  return { root, repo, home: join(root, "home") }
}

const adoptIt = async (f: ReturnType<typeof fixture>) => {
  const result = await adopt({
    path: f.repo,
    project: "P-AUT-128",
    delivery: "pr",
    label: "permissions-overhaul",
    pr: 1862,
    id: "permissions-1862",
    phase: "reconcile",
    at: "2026-11-21T00:00:00.000Z",
    home: f.home,
  })
  expect(result.ok).toBe(true)
}

test("a pass consumes its events, checkpoints the worktree, and survives worker exit", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    await appendEvent({
      id: "permissions-1862",
      home: f.home,
      event: {
        id: "review-1",
        kind: "review",
        at: "2026-11-21T00:01:00.000Z",
        payload: { body: "fix this" },
        status: "pending",
      },
    })
    const worker = join(f.root, "worker.sh")
    writeFileSync(
      worker,
      '#!/bin/sh\nprintf "%s" "$FACTORY_PROMPT" > "$FACTORY_WITNESS"\necho handled > handled.txt\n',
    )
    chmodSync(worker, 0o755)
    process.env.FACTORY_WITNESS = join(f.root, "prompt.txt")

    const result = await runPass({
      id: "permissions-1862",
      worker,
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.status).toBe("done")
    expect(result.receipt.journal).toBeDefined()
    if (result.receipt.journal !== undefined) expect(existsSync(result.receipt.journal)).toBe(true)
    expect(readFileSync(join(f.root, "prompt.txt"), "utf8")).toContain("review-1")
    expect((await readEvents({ id: "permissions-1862", home: f.home }))[0]?.status).toBe("consumed")
    expect((await readWorkstream({ id: "permissions-1862", home: f.home }))?.checkpoint.sha).toBe(
      result.checkpoint,
    )
    expect(
      execFileSync("git", ["-C", f.repo, "show", result.checkpoint + ":handled.txt"], {
        encoding: "utf8",
      }),
    ).toBe("handled\n")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a failed worker is charged, leaves events pending, and writes a failed receipt", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    await appendEvent({
      id: "permissions-1862",
      home: f.home,
      event: {
        id: "ticket-1",
        kind: "ticket",
        at: "2026-11-21T00:01:00.000Z",
        payload: {},
        status: "pending",
      },
    })
    const result = await runPass({
      id: "permissions-1862",
      worker: "exit 7",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.receipt?.status).toBe("failed")
    expect((await readEvents({ id: "permissions-1862", home: f.home }))[0]?.status).toBe("pending")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)
