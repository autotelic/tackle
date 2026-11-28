import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { adopt, type AdoptInput } from "../src/factory/adopt.ts"
import { appendEvent } from "../src/factory/events.ts"
import { runPass } from "../src/factory/kernel.ts"
import { readWorkstream, workstreamFile } from "../src/factory/store.ts"

/* oxlint-disable plumb/prefer-property-tests -- one fixed scratch repository and one fake CLI. */

const git = (cwd: string, ...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/**
 * A repository with no origin, so the checkpoint's push fails locally instead of reaching
 * github.com; delivery is trunk, so adoption never needs a fake `gh` either.
 */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "factory-notify-"))
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "factory@example.test")
  git(repo, "config", "user.name", "Factory Test")
  writeFileSync(join(repo, "README.md"), "base\n")
  git(repo, "add", "README.md")
  git(repo, "commit", "-q", "-m", "init")
  return { root, repo, home: join(root, "home") }
}

type Fixture = ReturnType<typeof fixture>

const adopted = (f: Fixture, overrides: Partial<AdoptInput> = {}) =>
  adopt({
    path: f.repo,
    project: "P-AUT-128",
    label: "permissions-overhaul",
    delivery: "trunk",
    pr: undefined,
    id: "permissions-1862",
    phase: "build",
    at: "2026-11-23T00:00:00.000Z",
    home: f.home,
    ...overrides,
  })

const taskEvent = (f: Fixture) =>
  appendEvent({
    id: "permissions-1862",
    home: f.home,
    event: {
      id: "ticket-1",
      kind: "task",
      at: "2026-11-23T00:01:00.000Z",
      payload: { task: "report the pass" },
      status: "pending",
    },
  })

/**
 * The intercom CLI as the host installs it: a node program that appends its argv to a log.
 *
 * `body` replaces the send, so a test can stand in a session that is not there.
 */
const fakeIntercom = (f: Fixture, body?: string) => {
  const log = join(f.root, "intercom.log")
  const cli = join(f.root, "intercom.mjs")
  writeFileSync(
    cli,
    [
      'import { appendFileSync } from "node:fs"',
      body ??
        "appendFileSync(" + JSON.stringify(log) + ', process.argv.slice(2).join(" ") + "\\n")',
      "",
    ].join("\n"),
  )
  process.env.PI_INTERCOM_CLI = cli
  return { sent: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) }
}

test("adopt records the notify target, and a record written before it decodes unchanged", async () => {
  const f = fixture()
  try {
    const result = await adopted(f, { notify: { session: "herdr", outcomes: ["blocked"] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.notify).toEqual({ session: "herdr", outcomes: ["blocked"] })

    const file = workstreamFile({ id: "permissions-1862", home: f.home })
    const written = JSON.parse(readFileSync(file, "utf8")) as { notify?: unknown }
    delete written.notify
    writeFileSync(file, JSON.stringify(written, null, 2) + "\n")

    const record = await readWorkstream({ id: "permissions-1862", home: f.home })
    expect(record?.notify).toBeUndefined()
    expect(record?.path).toBe(result.value.path)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a done pass tells the session once, with the truth fields", async () => {
  const f = fixture()
  try {
    const intercom = fakeIntercom(f)
    expect((await adopted(f, { notify: { session: "herdr" } })).ok).toBe(true)
    await taskEvent(f)

    const result = await runPass({
      id: "permissions-1862",
      worker: "true",
      at: "2026-11-23T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    const messages = intercom.sent()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("send --to herdr")
    expect(messages[0]).toContain("factory permissions-1862 pass #1 done")
    expect(messages[0]).toContain("phase build")
    expect(messages[0]).toContain("commit " + (result.receipt?.commit ?? "?").slice(0, 8))
    expect(messages[0]).toContain("next: factory status --json")
    expect(result.receipt?.notify).toMatchObject({ session: "herdr", outcome: "done", sent: true })
  } finally {
    delete process.env.PI_INTERCOM_CLI
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a gate pass names the desk that is waiting for an answer", async () => {
  const f = fixture()
  try {
    const intercom = fakeIntercom(f)
    expect((await adopted(f, { notify: { session: "herdr" } })).ok).toBe(true)
    await taskEvent(f)

    const result = await runPass({
      id: "permissions-1862",
      worker:
        "mkdir -p packages/board/src/factory && printf x > packages/board/src/factory/probe.ts",
      at: "2026-11-23T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(false)
    const messages = intercom.sent()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("pass #1 gate")
    expect(messages[0]).toContain("desk desk-permissions-1862-gate-1")
    expect(messages[0]).toContain("reason gate-protected")
    expect(result.receipt?.notify).toMatchObject({ outcome: "gate", sent: true })
  } finally {
    delete process.env.PI_INTERCOM_CLI
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a failed pass is attention, not a completion", async () => {
  const f = fixture()
  try {
    const intercom = fakeIntercom(f)
    // Only attention is asked for, so the same workstream says nothing when a pass finishes.
    expect((await adopted(f, { notify: { session: "herdr", outcomes: ["failed"] } })).ok).toBe(true)
    await taskEvent(f)

    const failed = await runPass({
      id: "permissions-1862",
      worker: "exit 3",
      at: "2026-11-23T00:02:00.000Z",
      home: f.home,
    })
    expect(failed.ok).toBe(false)
    const messages = intercom.sent()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("pass #1 failed")
    expect(messages[0]).toContain("desk none")

    const done = await runPass({
      id: "permissions-1862",
      worker: "true",
      at: "2026-11-23T00:03:00.000Z",
      home: f.home,
    })
    expect(done.ok).toBe(true)
    expect(intercom.sent()).toHaveLength(1)
    expect(done.receipt?.notify).toBeUndefined()
  } finally {
    delete process.env.PI_INTERCOM_CLI
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("a workstream with no session, and a refusal, tell nobody", async () => {
  const f = fixture()
  try {
    const intercom = fakeIntercom(f)
    expect((await adopted(f, { phase: "done" })).ok).toBe(true)

    const refused = await runPass({
      id: "permissions-1862",
      worker: "true",
      at: "2026-11-23T00:02:00.000Z",
      home: f.home,
    })
    expect(refused.ok).toBe(false)
    expect(refused.receipt).toBeUndefined()
    expect(intercom.sent()).toHaveLength(0)
  } finally {
    delete process.env.PI_INTERCOM_CLI
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)

test("an unreachable session is recorded on the receipt, not fatal", async () => {
  const f = fixture()
  try {
    fakeIntercom(f, 'process.stderr.write("no such session: herdr\\n")\nprocess.exit(1)')
    expect((await adopted(f, { notify: { session: "herdr" } })).ok).toBe(true)
    await taskEvent(f)

    const result = await runPass({
      id: "permissions-1862",
      worker: "true",
      at: "2026-11-23T00:02:00.000Z",
      home: f.home,
    })
    expect(result.ok).toBe(true)
    expect(result.receipt?.notify?.sent).toBe(false)
    expect(result.receipt?.notify?.detail).toContain("no such session")
    // The pass still consumed its event: a silent intercom did not undo the work.
    const record = await readWorkstream({ id: "permissions-1862", home: f.home })
    expect(record?.head).toBe(result.receipt?.commit)
  } finally {
    delete process.env.PI_INTERCOM_CLI
    rmSync(f.root, { recursive: true, force: true })
  }
}, 20_000)
