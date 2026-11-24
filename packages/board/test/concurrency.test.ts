/* oxlint-disable plumb/prefer-property-tests -- fixed git fixtures and process-boundary timing. */
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { adopt } from "../src/factory/adopt.ts"
import { appendEvent } from "../src/factory/events.ts"
import { runPass } from "../src/factory/kernel.ts"
import { readWorkstream, writeWorkstream } from "../src/factory/store.ts"

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

const repository = (root: string, name: string): string => {
  const repo = join(root, name)
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  return repo
}

const adoptTrunk = async (input: {
  readonly root: string
  readonly repo: string
  readonly id: string
}) => {
  const adopted = await adopt({
    path: input.repo,
    project: "factory",
    delivery: "trunk",
    pr: undefined,
    label: "dogfood",
    id: input.id,
    phase: "build",
    at: "2026-11-23T00:00:00.000Z",
    home: join(input.root, "home"),
  })
  expect(adopted.ok).toBe(true)
}

const addTask = async (input: {
  readonly root: string
  readonly id: string
  readonly at: string
}) => {
  await appendEvent({
    id: input.id,
    home: join(input.root, "home"),
    event: {
      id: "task-" + input.id,
      kind: "task",
      at: input.at,
      payload: { task: "touch handled.txt" },
      status: "pending",
    },
  })
}

test("two workstreams run concurrently without a global pass lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-concurrent-"))
  try {
    const repoA = repository(root, "a")
    const repoB = repository(root, "b")
    await adoptTrunk({ root, repo: repoA, id: "a" })
    await adoptTrunk({ root, repo: repoB, id: "b" })
    await addTask({ root, id: "a", at: "2026-11-23T00:01:00.000Z" })
    await addTask({ root, id: "b", at: "2026-11-23T00:01:01.000Z" })

    const witness = join(root, "witness")
    const worker = join(root, "worker.sh")
    writeFileSync(
      worker,
      '#!/bin/sh\nprintf "%s\\n" "$FACTORY_WORKSTREAM" >> "$WITNESS"\nsleep 0.2\necho handled > handled.txt\n',
    )
    chmodSync(worker, 0o755)
    process.env.WITNESS = witness

    const [a, b] = await Promise.all([
      runPass({ id: "a", worker, at: "2026-11-23T00:02:00.000Z", home: join(root, "home") }),
      runPass({ id: "b", worker, at: "2026-11-23T00:02:00.000Z", home: join(root, "home") }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(
      readFileSync(witness, "utf8")
        .trim()
        .split("\n")
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(["a", "b"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("a second pass on the same workstream refuses while the first holds the lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-lock-"))
  try {
    const repo = repository(root, "a")
    await adoptTrunk({ root, repo, id: "a" })
    await addTask({ root, id: "a", at: "2026-11-23T00:01:00.000Z" })

    const witness = join(root, "witness")
    const worker = join(root, "worker.sh")
    writeFileSync(
      worker,
      '#!/bin/sh\nprintf "%s\\n" "$FACTORY_WORKSTREAM" >> "$WITNESS"\nsleep 0.5\necho handled > handled.txt\n',
    )
    chmodSync(worker, 0o755)
    process.env.WITNESS = witness

    const first = runPass({
      id: "a",
      worker,
      at: "2026-11-23T00:02:00.000Z",
      home: join(root, "home"),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const second = await runPass({
      id: "a",
      worker,
      at: "2026-11-23T00:02:01.000Z",
      home: join(root, "home"),
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toMatch(/^PassRunning/)
    expect((await first).ok).toBe(true)
    expect(readFileSync(witness, "utf8").trim().split("\n")).toEqual(["a"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

test("a stale pass write preserves an operator budget change", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-stale-record-"))
  try {
    const repo = repository(root, "a")
    await adoptTrunk({ root, repo, id: "a" })
    const started = await readWorkstream({ id: "a", home: join(root, "home") })
    expect(started).toBeDefined()
    if (started === undefined) return
    await writeWorkstream({
      home: join(root, "home"),
      record: {
        ...started,
        budgets: { ...started.budgets, passesPerPhase: 100 },
        updatedAt: "2026-11-24T18:00:00.000Z",
      },
    })
    await writeWorkstream({
      home: join(root, "home"),
      record: { ...started, head: "f".repeat(40), updatedAt: started.updatedAt },
    })
    const after = await readWorkstream({ id: "a", home: join(root, "home") })
    expect(after?.budgets.passesPerPhase).toBe(100)
    expect(after?.head).toBe("f".repeat(40))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a stale pass lock from a dead process is reclaimed after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-stale-lock-"))
  try {
    const repo = repository(root, "a")
    await adoptTrunk({ root, repo, id: "a" })
    await addTask({ root, id: "a", at: "2026-11-23T00:01:00.000Z" })
    const record = await readWorkstream({ id: "a", home: join(root, "home") })
    expect(record).toBeDefined()
    if (record === undefined) return
    await writeWorkstream({
      home: join(root, "home"),
      record: { ...record, phase: "build" },
    })
    writeFileSync(join(root, "home", "workstreams", "a.pass.lock"), "99999999")

    const worker = join(root, "worker.sh")
    writeFileSync(worker, "#!/bin/sh\necho handled > handled.txt\n")
    chmodSync(worker, 0o755)

    const result = await runPass({
      id: "a",
      worker,
      at: "2026-11-23T00:02:00.000Z",
      home: join(root, "home"),
    })
    expect(result.ok).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
