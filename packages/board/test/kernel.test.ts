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
import { appendEvent, readEvents, type Event } from "../src/factory/events.ts"
import { followUpEvent, readyForHuman, runPass, type Receipt } from "../src/factory/kernel.ts"
import { readWorkstream } from "../src/factory/store.ts"

/* oxlint-disable plumb/prefer-property-tests, plumb/no-known-value-widening -- fixed scratch repo and fixture builder. */

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
      '#!/bin/sh\nprintf "%s" "$FACTORY_PROMPT" > "$FACTORY_WITNESS"\nprintf "%s" "$FACTORY_THINKING" > "$FACTORY_THINKING_WITNESS"\necho handled > handled.txt\n',
    )
    chmodSync(worker, 0o755)
    process.env.FACTORY_WITNESS = join(f.root, "prompt.txt")
    process.env.FACTORY_THINKING_WITNESS = join(f.root, "thinking.txt")

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
    expect(readFileSync(join(f.root, "thinking.txt"), "utf8")).toBe("low")
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

const receiptWith = (input: {
  readonly record: Awaited<ReturnType<typeof readWorkstream>>
  readonly before: number
  readonly after: number
  readonly events?: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>
}): {
  readonly receipt: Receipt
  readonly events: ReadonlyArray<Event>
} => {
  if (input.record === undefined) throw new Error("workstream missing")
  const quality = (errors: number) => ({
    available: true,
    errors,
    warnings: 0,
    note: "jig check",
  })
  return {
    events: (input.events ?? []).map((event, index) => ({
      id: "event-" + index,
      kind: event.kind,
      at: "2026-11-21T00:01:00.000Z",
      payload: event.payload,
      status: "consumed" as const,
    })),
    receipt: {
      workstream: input.record.id,
      pass: 2,
      at: "2026-11-21T00:02:00.000Z",
      status: "done",
      phase: input.record.phase,
      events: [],
      checkpoint: input.record.head,
      exit: 0,
      quality: {
        before: quality(input.before),
        after: quality(input.after),
        regressed: false,
      },
    },
  }
}

test("an improving red pass queues one quality follow-up", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    const record = await readWorkstream({ id: "permissions-1862", home: f.home })
    const { receipt, events } = receiptWith({ record, before: 5, after: 2 })
    const [followUp] = followUpEvent({ record: record!, receipt, events })
    expect(followUp?.kind).toBe("quality")
    expect(followUp?.payload).toMatchObject({ pass: 2, errors: 2, warnings: 0 })
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a stalled red pass does not queue a follow-up", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    const record = await readWorkstream({ id: "permissions-1862", home: f.home })
    const { receipt, events } = receiptWith({ record, before: 2, after: 2 })
    expect(followUpEvent({ record: record!, receipt, events })).toEqual([])
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a clean check pass is ready for a human", async () => {
  const f = fixture()
  try {
    await adoptIt(f)
    const record = await readWorkstream({ id: "permissions-1862", home: f.home })
    const { receipt, events } = receiptWith({
      record,
      before: 1,
      after: 0,
      events: [{ kind: "check", payload: { state: "passed" } }],
    })
    expect(readyForHuman({ record: record!, receipt, events })).toBe(true)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a pass that changes nothing reuses its before measurement", async () => {
  const f = fixture()
  const originalPath = process.env.PATH
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
    const bin = join(f.root, "bin")
    mkdirSync(bin, { recursive: true })
    const jig = join(bin, "jig")
    const argsFile = join(f.root, "jig-once.txt")
    writeFileSync(
      jig,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$JIG_ONCE"',
        'printf \'{"generators":[],"diagnostics":[]}\'',
      ].join("\n"),
    )
    chmodSync(jig, 0o755)
    process.env.JIG_ONCE = argsFile
    process.env.PATH = bin + ":" + (originalPath ?? "")

    const result = await runPass({
      id: "permissions-1862",
      worker: "/bin/sh -c true",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    const checks = readFileSync(argsFile, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("check"))
    expect(checks).toHaveLength(1)
  } finally {
    delete process.env.JIG_ONCE
    process.env.PATH = originalPath
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a PR workstream scopes its quality check to the PR", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, ".gitignore"), "node_modules\n")
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
    const bin = join(f.repo, "node_modules", ".bin")
    mkdirSync(bin, { recursive: true })
    const jig = join(bin, "jig")
    const argsFile = join(f.root, "jig-args.txt")
    writeFileSync(
      jig,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$@" >> "$JIG_ARGS"',
        'printf \'{"scope":"touched-files","generators":[],"diagnostics":[]}\'',
      ].join("\n"),
    )
    chmodSync(jig, 0o755)
    process.env.JIG_ARGS = argsFile

    const result = await runPass({
      id: "permissions-1862",
      worker: "/bin/sh -c 'echo handled > handled.txt'",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.quality?.after.errors).toBe(0)
    const args = readFileSync(argsFile, "utf8")
    expect(args).toContain("--pr-number")
    expect(args).toContain("1862")
  } finally {
    delete process.env.JIG_ARGS
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("an older jig report without a scope is treated as touched, not mismatched", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.repo, ".gitignore"), "node_modules\n")
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
    const bin = join(f.repo, "node_modules", ".bin")
    mkdirSync(bin, { recursive: true })
    const jig = join(bin, "jig")
    writeFileSync(jig, ["#!/bin/sh", 'printf \'{"generators":[],"diagnostics":[]}\''].join("\n"))
    chmodSync(jig, 0o755)

    const result = await runPass({
      id: "permissions-1862",
      worker: "/bin/sh -c 'echo handled > handled.txt'",
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.quality?.after).toMatchObject({
      available: true,
      scope: "touched-files",
      complete: false,
    })
    expect(result.receipt.quality?.after.note).toContain("no scope")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a worker exit 2 blocks the workstream and leaves the event pending", async () => {
  const f = fixture()
  try {
    const adopted = await adopt({
      path: f.repo,
      project: "P-AUT-128",
      delivery: "pr",
      label: "permissions-overhaul",
      pr: 1862,
      id: "permissions-1862",
      phase: "build",
      worker: "/bin/sh -c 'exit 2'",
      at: "2026-11-21T00:00:00.000Z",
      home: f.home,
    })
    expect(adopted.ok).toBe(true)
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
      at: "2026-11-21T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("blocked-on-human")
    expect(result.receipt?.exit).toBe(2)
    expect((await readWorkstream({ id: "permissions-1862", home: f.home }))?.phase).toBe("blocked")
    expect((await readEvents({ id: "permissions-1862", home: f.home }))[0]?.status).toBe("pending")
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
