import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { NodeServices } from "@effect/platform-node"
import { Effect, Result } from "effect"
import * as fc from "fast-check"
import type { Sql, SqlValue } from "./sql.ts"

/** `node:sqlite` for the tests; the package source only knows the `Sql` port. */
class NodeSql implements Sql {
  readonly #db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.#db = db
  }
  exec(sql: string, ...params: ReadonlyArray<SqlValue>): void {
    this.#db.prepare(sql).run(...params)
  }
  all<T>(sql: string, ...params: ReadonlyArray<SqlValue>): ReadonlyArray<T> {
    // SAFETY: the caller names the row type and the driver returns named columns.
    const rows = this.#db.prepare(sql).all(...params)
    // SAFETY: node:sqlite returns named columns; the caller names the row shape.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/no-chained-type-assertions plumb/require-safety-comment-for-type-assertion
    return rows.map((row) => row as unknown as T)
  }
  get<T>(sql: string, ...params: ReadonlyArray<SqlValue>): T | undefined {
    // SAFETY: node:sqlite returns named columns; the caller names the row shape.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/no-chained-type-assertions plumb/require-safety-comment-for-type-assertion
    return this.#db.prepare(sql).get(...params) as unknown as T | undefined
  }
  transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE")
    const value = run()
    this.#db.exec("COMMIT")
    return value
  }
}
import { describe, expect, it } from "vitest"
import type { Board } from "./client.ts"
import type { RoomConfig } from "./config.ts"
import {
  addressRefusal,
  doctor,
  initRefusal,
  initRoomConfig,
  keptFields,
  renderBoard,
  renderPlan,
  resolveAddress,
} from "./commands.ts"
import {
  callerOf,
  claimedWorktree,
  readDriver,
  releaseDriver,
  renderDriver,
  sayRefusal,
  worktreeName,
  writeDriver,
} from "./driver.ts"
import type { InitOptions } from "./commands.ts"
import { daemon, wantsWatcher } from "./daemon.ts"
import { fromGithub, fromLinear } from "./ingest.ts"
import { shouldReview, unaddressed } from "./policy.ts"
import { promptOf } from "./review.ts"
import { run } from "./shell.ts"
import { isTelemetry, sessionEntryOf } from "./session.ts"
import { inboxFor } from "./inbox.ts"
import { readIndex, recordRoom } from "./paths.ts"
import { Ledger } from "./ledger.ts"
import type { Job } from "@autotelic/board"

const ledger = (): Ledger =>
  Ledger.open(new NodeSql(new DatabaseSync(":memory:")), "linear:p@local/t")

const job = (id: string): Job => ({
  id,
  room: "linear:p@local/t",
  kind: "review",
  pr: 1,
  sha: "abc",
  state: "queued",
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
})

describe("webhooks", () => {
  it("turns a review request into the person it addresses", () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "d1",
      now: 10,
      body: {
        action: "review_requested",
        pull_request: {
          number: 1709,
          title: "season",
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
        },
        requested_reviewer: { login: "togmund" },
      },
    })
    expect(event).toMatchObject({
      kind: "review.requested",
      pr: 1709,
      sha: "abcdef123456",
      reviewer: "togmund",
      author: "eadmundo",
      draft: false,
    })
  })

  it("degrades a malformed payload to unknown instead of throwing", () => {
    expect(fromGithub({ event: "pull_request", delivery: "d", body: "nope", now: 1 }).kind).toBe(
      "unknown",
    )
  })

  it("reads a Linear issue state", () => {
    const event = fromLinear({
      delivery: "l1",
      now: 1,
      body: { action: "update", data: { identifier: "DEV-1506", state: { name: "Done" } } },
    })
    expect(event).toMatchObject({ kind: "issue.changed", identifier: "DEV-1506", state: "Done" })
  })
})

const CONFIG: RoomConfig = {
  version: 1,
  room: "probe",
  name: "probe",
  stage: "local/togmund",
  project: { kind: "linear", id: "p", name: "p" },
  repo: { owner: "o", name: "r", root: "." },
  ingress: { github: "forward", linear: "poll" },
  review: { trigger: "review_requested", provider: "p", model: "m", slots: 1 },
  createdAt: "2026-01-01T00:00:00.000Z",
}

/** Run the doctor's checks against a machine this test describes. */
const diagnose = async (look: (name: string) => string | undefined) => {
  const root = mkdtempSync(join(tmpdir(), "room-doctor-"))
  const previous = process.env.ROOM_URL
  process.env.ROOM_URL = "http://127.0.0.1:9"
  writeFileSync(join(root, "room.config.json"), JSON.stringify(CONFIG))
  try {
    const checks = await Effect.runPromise(
      doctor(root, { look }).pipe(Effect.provide(NodeServices.layer)),
    )
    return checks.find((check) => check.name === "pi")
  } finally {
    process.env.ROOM_URL = previous
    rmSync(root, { recursive: true, force: true })
  }
}

describe("the board", () => {
  it("reports delivery next to claims, so four events never read as none", () => {
    const board: Board = {
      room: "probe",
      inbox: { pending: 2, turns: 2, cards: 0, held: 1 },
      counts: { chits: 0, jobs: 0, receipts: 0 },
      chits: [],
      jobs: [],
      claims: [],
      presence: [],
      workers: [],
    }
    const text = renderBoard({ config: CONFIG, board, now: 1_700_000_012_000 })
    // Four delivered events used to read as "chits none": delivery is not a claimable chit.
    expect(text).toContain("inbox   2 turn(s) · 0 card(s) waiting · 1 held by the batch")
    // A filtered room and a dead forwarder must not render identically.
    expect(
      renderBoard({ config: CONFIG, board: { ...board, unrouted: 2 }, now: 1_700_000_012_000 }),
    ).toContain("unrouted 2 review event(s) were not this room's label")
    // The claim is a different fact from presence: `here` is the daemon, `driving` is the
    // session, and a board that printed only the machine left "who is on this" unanswerable.
    expect(text).toContain("driving nobody")
    expect(
      renderBoard({
        config: CONFIG,
        board,
        now: 1_700_000_012_000,
        driver: {
          sessionId: "01a18442",
          worktree: "/Users/t/seed-stack",
          host: "macbook",
          attachedAt: 1_700_000_000_000,
        },
      }),
    ).toContain("driving 01a18442 · seed-stack")
  })
})

describe("the review prompt", () => {
  const pr = {
    number: 1810,
    title: "season rollup",
    body: "notes",
    author: "eadmundo",
    headRefOid: "48c15ac264d37d3cb752c0274febad8a655980c6",
    baseRefOid: "aaaa",
    additions: 1,
    deletions: 1,
    files: ["src/a.ts"],
    isDraft: false,
  }

  it("never claims a check it did not run, and says where to stand", () => {
    const unchecked = promptOf({
      pr,
      files: pr.files,
      findings: [],
      jigNote: "jig did not run (ENOBUFS, exit 1): spawnSync ...",
      jigRan: false,
      worktree: "/w/pr-1810-48c15ac2",
      sha: pr.headRefOid,
    })
    // The inverted header is the fix: the old wording told the reviewer to skip work that had
    // not been done, which is worse than saying nothing at all.
    expect(unchecked).toContain("## Machine checks that did not run")
    expect(unchecked).toContain("Do not assume anything was checked")
    expect(unchecked).not.toContain("do not repeat these")
    expect(unchecked).toContain("worktree: /w/pr-1810-48c15ac2")
    expect(unchecked).toContain("sha: 48c15ac264d37d3c")

    const checked = promptOf({
      pr,
      files: pr.files,
      findings: [],
      jigNote: "",
      jigRan: true,
      worktree: "/w",
      sha: "abc",
    })
    expect(checked).toContain("## Machine checks already run (do not repeat these)")
    expect(checked).toContain("jig: no findings on the changed files.")
  })
})

describe("the command boundary", () => {
  it("names a spawn failure instead of reporting it as a missing command", () => {
    const outcome = run({ command: "definitely-not-a-command-xyz", args: [] })
    expect(outcome.failure).toBe("ENOENT")
    // 127 used to mean both "not found" and "could not hold the output".
    expect(outcome.code).not.toBe(127)
  })

  it("holds a report bigger than the buffer that made one look like a missing binary", () => {
    // The regression: jig's full report exceeded spawnSync's default and was reported as exit
    // 127, so the prompt told the reviewer to skip checks that never ran.
    const outcome = run({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(4_000_000))'],
    })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.stdout.length).toBe(4_000_000)
  })
})

describe("the daemon's dev loop", () => {
  it("hands itself to node's watcher once, and only when asked", () => {
    expect(wantsWatcher({ watch: true, watched: false })).toBe(true)
    expect(wantsWatcher({ watch: false, watched: false })).toBe(false)
    // Node strips its exec arguments for the watched child, so the guard cannot be
    // `execArgv.includes("--watch")`: the child would spawn another watcher, forever. The
    // marker is the environment, which survives the re-exec.
    expect(wantsWatcher({ watch: true, watched: true })).toBe(false)
  })
})

describe("the doctor", () => {
  // doctor spawns `gh` and probes the room URL: give it room to breathe under a parallel run.
  it("names a missing pi, because the review and the wake both run it", async () => {
    const missing = await diagnose((name) => (name === "pi" ? undefined : "/usr/bin/" + name))
    expect(missing?.ok).toBe(false)
    expect(missing?.detail).toContain("the review and the session wake both run it")

    const installed = await diagnose(() => "/usr/bin/yes")
    expect(installed?.ok).toBe(true)
  }, 30_000)
})

describe("the label trigger", () => {
  const labeled = () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "d2",
      now: 10,
      body: {
        action: "labeled",
        pull_request: {
          number: 1710,
          title: "season",
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
          labels: [{ name: "multi-season" }],
        },
        label: { name: "multi-season" },
      },
    })
    return event
  }

  it("turns a labeled PR into a pr.ready event with its labels", () => {
    expect(labeled()).toMatchObject({
      kind: "pr.ready",
      pr: 1710,
      author: "eadmundo",
      labels: ["multi-season"],
    })
  })

  it("acts on the label, without a review request", () => {
    expect(shouldReview({ event: labeled(), actor: "github:togmund", label: "multi-season" })).toBe(
      true,
    )
  })

  it("does not review its own actor's PR", () => {
    expect(
      shouldReview({ event: labeled(), actor: "github:eadmundo", label: "multi-season" }),
    ).toBe(false)
  })

  it("does not act on a different label", () => {
    expect(shouldReview({ event: labeled(), actor: "github:togmund", label: "payroll" })).toBe(
      false,
    )
  })
})

describe("a review request as a trigger", () => {
  const requested = (labels: ReadonlyArray<string>) =>
    fromGithub({
      event: "pull_request",
      delivery: `r-${labels.join("-")}`,
      now: 10,
      body: {
        action: "review_requested",
        pull_request: {
          number: 1712,
          title: "season",
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
          labels: labels.map((name) => ({ name })),
        },
        requested_reviewer: { login: "togmund" },
      },
    })

  it("carries the PR's labels, so the request can be scoped at all", () => {
    expect(requested(["maintenance"])).toMatchObject({
      kind: "review.requested",
      labels: ["maintenance"],
    })
  })

  it("is not this room's when the PR carries another workstream's label", () => {
    // The defect: a review request names a person, not a project, so one reviewer in common
    // flooded every room that watched them -- triage arrived inside a session, mid-rebase.
    expect(
      shouldReview({
        event: requested(["payroll"]),
        actor: "github:togmund",
        label: "maintenance",
      }),
    ).toBe(false)
    expect(
      shouldReview({
        event: requested(["maintenance"]),
        actor: "github:togmund",
        label: "maintenance",
      }),
    ).toBe(true)
    // A room with no watched label is not scoped: nothing was configured to scope it by.
    expect(shouldReview({ event: requested([]), actor: "github:togmund" })).toBe(true)
  })

  it("counts a scoped-away request instead of dropping it in silence", () => {
    expect(
      unaddressed({ event: requested(["payroll"]), label: "maintenance", queued: false }),
    ).toBe(true)
    expect(
      unaddressed({ event: requested(["maintenance"]), label: "maintenance", queued: true }),
    ).toBe(false)
    expect(unaddressed({ event: requested([]), label: undefined, queued: false })).toBe(false)
  })
})

describe("a submitted review as a trigger", () => {
  const reviewed = (state: string, labels: ReadonlyArray<string> = ["multi-season"]) =>
    fromGithub({
      event: "pull_request_review",
      delivery: "d-review",
      now: 10,
      body: {
        action: "submitted",
        review: { user: { login: "eadmundo" }, state, body: "drops the parent id" },
        pull_request: {
          number: 1711,
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
          labels: labels.map((name) => ({ name })),
        },
      },
    })

  it("carries the PR's labels, so the policy can scope itself", () => {
    expect(reviewed("changes_requested")).toMatchObject({
      kind: "review.submitted",
      labels: ["multi-season"],
    })
  })

  it("queues on changes_requested when the room asks for feedback", () => {
    expect(
      shouldReview({
        event: reviewed("changes_requested"),
        actor: "github:togmund",
        label: "multi-season",
        trigger: "review_submitted",
      }),
    ).toBe(true)
  })

  it("ignores an approval: it does not ask for another pass", () => {
    expect(
      shouldReview({
        event: reviewed("approved"),
        actor: "github:togmund",
        label: "multi-season",
        trigger: "review_submitted",
      }),
    ).toBe(false)
  })

  it("ignores its own review, so a pass cannot trigger itself", () => {
    expect(
      shouldReview({
        event: reviewed("changes_requested"),
        actor: "github:eadmundo",
        label: "multi-season",
        trigger: "review_submitted",
      }),
    ).toBe(false)
  })

  it("stays quiet unless the config asks for it", () => {
    expect(
      shouldReview({
        event: reviewed("changes_requested"),
        actor: "github:togmund",
        label: "multi-season",
        trigger: "review_requested",
      }),
    ).toBe(false)
    expect(
      shouldReview({
        event: reviewed("changes_requested"),
        actor: "github:togmund",
        label: "multi-season",
      }),
    ).toBe(false)
  })

  it("scopes an inline comment to the room's label", () => {
    const comment = fromGithub({
      event: "pull_request_review_comment",
      delivery: "d-thread",
      now: 10,
      body: {
        action: "created",
        comment: { id: 9, user: { login: "eadmundo" }, path: "a.ts", line: 4, body: "this line" },
        pull_request: {
          number: 1712,
          draft: false,
          user: { login: "eadmundo" },
          head: { sha: "abcdef123456" },
          labels: [{ name: "other" }],
        },
      },
    })
    expect(
      shouldReview({
        event: comment,
        actor: "github:togmund",
        label: "multi-season",
        trigger: "review_comment",
      }),
    ).toBe(false)
  })
})

describe("unreadable entries", () => {
  it("names an entry with no kind instead of rendering undefined", () => {
    // The live room's entry 9: kind "undefined", no payload, written before the argument fix.
    expect(sessionEntryOf({ id: "9", kind: "undefined" })).toEqual({
      id: "9",
      kind: "unreadable",
      text: "(no kind or payload; written by an older surface)",
    })
    expect(
      sessionEntryOf({ id: "21", kind: "room.decision", data: { raw: '{"probe":"x"}' } }),
    ).toEqual({
      id: "21",
      kind: "room.decision",
      text: '{"probe":"x"}',
    })
  })
})

const ciRun = (input: {
  readonly attempt?: number
  readonly conclusion?: string
  readonly pr?: number | null
}) =>
  fromGithub({
    event: "workflow_run",
    delivery: "wf-1",
    now: 10,
    body: {
      action: "completed",
      workflow_run: {
        id: 9001,
        run_attempt: input.attempt ?? 1,
        name: "Lint & test",
        conclusion: input.conclusion ?? "failure",
        head_sha: "abc123",
        html_url: "https://example.test/run/9001",
        pull_requests: input.pr === null ? [] : [{ number: input.pr ?? 1776 }],
      },
    },
  })

describe("CI runs", () => {
  it("is a fact: an event and a receipt, never a turn or a job", () => {
    const event = ciRun({})
    expect(event).toMatchObject({
      kind: "ci.completed",
      pr: 1776,
      workflow: "Lint & test",
      conclusion: "failure",
      attempt: 1,
    })
    // A rerun on the same commit is new information, so the attempt is in the identity.
    expect(event.id).toBe("gh:workflow_run:9001:1")
    expect(ciRun({ attempt: 2, conclusion: "success" }).id).toBe("gh:workflow_run:9001:2")
    expect(inboxFor({ event, actor: "github:togmund" })).toMatchObject({ _tag: "Failure" })
  })

  it("derives the newest verdict per pull request and workflow", () => {
    const store = ledger()
    const receipt = (id: string, at: number, conclusion: string) =>
      store.append({
        id,
        room: store.room,
        at,
        kind: "ci.completed",
        payload: {
          pr: 1776,
          sha: "abc123",
          workflow: "Lint & test",
          conclusion,
          url: "https://example.test/run/9001",
        },
      })
    receipt("run-1", 1, "failure")
    receipt("run-2", 2, "success")
    // A run with no pull request has no board line.
    store.append({
      id: "orphan",
      room: store.room,
      at: 3,
      kind: "ci.completed",
      payload: { pr: null, sha: "x", workflow: "Deploy", conclusion: "failure", url: "" },
    })
    expect(store.checks()).toEqual([
      {
        pr: 1776,
        workflow: "Lint & test",
        conclusion: "success",
        sha: "abc123",
        url: "https://example.test/run/9001",
        at: 2,
        runId: 0,
        attempt: 1,
        // The receipt fixture carries no runId, so there is no earlier attempt to name.
        previous: null,
      },
    ])
  })

  it("names the attempt a rerun replaced, and leaves a first attempt unqualified", () => {
    const store = ledger()
    const receipt = (id: string, at: number, attempt: number, conclusion: string) =>
      store.append({
        id,
        room: store.room,
        at,
        kind: "ci.completed",
        payload: {
          pr: 1776,
          sha: "abc123",
          workflow: "Lint & test",
          conclusion,
          url: "",
          runId: 9200,
          attempt,
        },
      })
    receipt("run-9200-1", 1, 1, "failure")
    receipt("run-9200-2", 2, 2, "success")
    const board = (checks: NonNullable<Board["checks"]>): Board => ({
      room: "probe",
      checks,
      counts: { chits: 0, jobs: 0, receipts: 2 },
      chits: [],
      jobs: [],
      claims: [],
      presence: [],
      workers: [],
    })
    const text = renderBoard({ config: CONFIG, board: board(store.checks()), now: 3 })
    // A rerun must not launder the attempt it replaced.
    expect(text).toContain("ci      #1776 Lint & test ok (rerun 2; attempt 1 failed)")

    const first = store.checks().map((check) => ({ ...check, attempt: 1, previous: null }))
    expect(renderBoard({ config: CONFIG, board: board(first), now: 3 })).toContain(
      "ci      #1776 Lint & test ok",
    )
  })

  it("keeps a skipped run its own verdict, on the board", () => {
    const store = ledger()
    store.append({
      id: "run-skip",
      room: store.room,
      at: 1,
      kind: "ci.completed",
      payload: {
        pr: 1744,
        sha: "def456",
        workflow: "Lint & test",
        conclusion: "skipped",
        url: "",
      },
    })
    const board: Board = {
      room: "probe",
      checks: store.checks(),
      counts: { chits: 0, jobs: 0, receipts: 1 },
      chits: [],
      jobs: [],
      claims: [],
      presence: [],
      workers: [],
    }
    const text = renderBoard({ config: CONFIG, board, now: 1 })
    // A paths-filtered run that skipped every job is not a pass.
    expect(text).toContain("ci      #1744 Lint & test --")
  })
})

describe("talk and telemetry", () => {
  it("keeps the surface narrating itself out of the conversation view", () => {
    // A live room held 19 room.edit entries of 29; the conversation view must still read as one.
    for (const kind of ["room.edit", "room.session", "room.tool"]) {
      expect(isTelemetry(kind)).toBe(true)
    }
    for (const kind of ["room.decision", "room.message", "room.reply", "pi.user"]) {
      expect(isTelemetry(kind)).toBe(false)
    }
  })
})

describe("rebinding a checkout", () => {
  const bound: RoomConfig = {
    ...CONFIG,
    name: "seed-generator",
    room: "linear:7b1e4551@local/togmund",
    project: { kind: "linear", id: "7b1e4551", name: "Seed data that behaves like production" },
    watch: { label: "v1-data-migration" },
    review: {
      trigger: "review_requested",
      provider: "opencode-go",
      model: "tuned-model",
      slots: 2,
    },
    worker: { substrate: "hc", app: { up: "make up" } },
    batchMs: 45_000,
  }

  const rebind = (options: Partial<InitOptions> = {}): RoomConfig =>
    initRoomConfig({
      options: {
        name: "seed-generator",
        projectId: "7b1e4551",
        projectName: "Seed data that behaves like production",
        workspace: undefined,
        label: undefined,
        linearUser: undefined,
        now: 2,
        ...options,
      },
      stage: "local/togmund",
      repo: { owner: "o", name: "r" },
      root: ".",
      previous: bound,
    })

  it("refuses with the room this checkout is bound to, not just 'already exists'", () => {
    const refusal = initRefusal({ exists: true, force: false, previous: bound })
    expect(refusal).toContain("seed-generator")
    expect(refusal).toContain("Seed data that behaves like production")
    expect(refusal).toContain("rebind")
    expect(initRefusal({ exists: true, force: true, previous: bound })).toBeUndefined()
  })

  it("names an unreadable config rather than pretending it knows the binding", () => {
    expect(initRefusal({ exists: true, force: false, previous: undefined })).toContain(
      "does not decode",
    )
  })

  it("keeps what no flag speaks for, so a rewrite is not a reset", () => {
    const config = rebind()
    // The reported defect: `--force` without `--label` dropped the watch label, leaving the
    // label column empty, and reset the review model and the worker block with it.
    expect(config.watch).toEqual({ label: "v1-data-migration" })
    expect(config.review.model).toBe("tuned-model")
    expect(config.worker?.app?.up).toBe("make up")
    expect(config.batchMs).toBe(45_000)
  })

  it("lets a flag override the field it speaks for", () => {
    expect(rebind({ label: "seed-generator", name: "other" }).watch).toEqual({
      label: "seed-generator",
    })
    expect(rebind({ name: "other" }).name).toBe("other")
  })

  it("says which fields came from the previous file", () => {
    const kept = keptFields(bound, {
      label: undefined,
      linearUser: undefined,
      workspace: undefined,
    })
    expect(kept).toContain("watch.label")
    expect(kept).toContain("review")
    expect(kept).not.toContain("linearUser")
    expect(
      keptFields(undefined, { label: undefined, linearUser: undefined, workspace: undefined }),
    ).toEqual([])
  })
})

describe("the daemon with no room server", () => {
  it("refuses once, and names the command that starts one", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        daemon({ config: CONFIG, url: "http://127.0.0.1:9", once: true, log: () => undefined }),
      ),
    )
    expect(Result.isFailure(result)).toBe(true)
    const message = Result.isFailure(result) ? result.failure.message : ""
    expect(message).toContain("no room server")
    expect(message).toContain("jig room dev")
  })
})

describe("the plan's existing line", () => {
  it("names the bound room and its project, not the internal address", () => {
    const text = renderPlan(
      {
        root: "/r",
        repo: "o/r",
        login: "togmund",
        authenticated: true,
        linearToken: true,
        config: CONFIG,
        rooms: [],
      },
      0,
    )
    expect(text).toContain("  existing  probe (p, local/togmund)")
    expect(text).not.toContain("linear:")
  })
})

describe("voiding a job", () => {
  it("takes a queued job out of the queue without losing the row", () => {
    const store = ledger()
    store.enqueue(job("pr:47:abc123"))
    expect(store.voidJob("pr:47:abc123", 2)).toBe(1)
    // The daemon can no longer claim it, and the record is still on the board.
    expect(Result.getOrUndefined(store.claimJob("mac@worker", 3))).toBeUndefined()
    expect(store.jobs()[0]?.state).toBe("void")
  })

  it("reports nothing to void for an unknown or finished job", () => {
    const store = ledger()
    expect(store.voidJob("pr:1:none", 1)).toBe(0)
    store.enqueue(job("pr:1:abc"))
    store.claimJob("mac@worker", 2)
    store.finishJob("pr:1:abc", "done", undefined, 3)
    expect(store.voidJob("pr:1:abc", 4)).toBe(0)
  })
})

describe("workers", () => {
  it("records and refreshes a worker session", () => {
    const store = ledger()
    store.putWorker({
      name: "room-1-fix",
      room: store.room,
      pr: 1,
      kind: "fix",
      address: "t2",
      worktree: "/tmp/wt",
      state: "live",
      port: 53180,
      url: "http://127.0.0.1:53180/",
      appAddress: "t6",
      startedAt: 1,
      updatedAt: 1,
    })
    expect(store.workers()).toHaveLength(1)
    expect(store.workers()[0]?.url).toBe("http://127.0.0.1:53180/")
    store.putWorker({
      name: "room-1-fix",
      room: store.room,
      pr: 1,
      kind: "fix",
      address: "t2",
      worktree: "/tmp/wt",
      state: "done",
      startedAt: 1,
      updatedAt: 2,
    })
    expect(store.workers()[0]?.state).toBe("done")
  })
})

describe("the project inbox", () => {
  it("dedupes by delivery id and acknowledges", () => {
    const store = ledger()
    expect(
      store.enqueueInbox({ id: "i1", kind: "turn", pr: 1, text: "hi", at: 1, holdUntil: 0 }),
    ).toBe(true)
    expect(
      store.enqueueInbox({ id: "i1", kind: "turn", pr: 1, text: "hi", at: 1, holdUntil: 0 }),
    ).toBe(false)
    const items = store.inbox(0, 10_000)
    expect(items).toHaveLength(1)
    expect(store.ackInbox([items[0]?.seq ?? 0], 2)).toBe(1)
    expect(store.inbox(0, 10_000)).toHaveLength(0)
  })

  it("batches a sweep on one PR until the hold expires", () => {
    const store = ledger()
    store.enqueueInbox({
      id: "b1",
      kind: "turn",
      pr: 9,
      text: "first",
      at: 1_000,
      holdUntil: 2_000,
    })
    store.enqueueInbox({
      id: "b2",
      kind: "turn",
      pr: 9,
      text: "second",
      at: 1_500,
      holdUntil: 3_000,
    })
    expect(store.inbox(0, 2_500)).toHaveLength(0)
    const items = store.inbox(0, 3_000)
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toContain("first")
    expect(items[0]?.text).toContain("second")
  })

  it("routes Ed's comment as a turn and stays quiet on the actor's own", () => {
    const event = fromGithub({
      event: "pull_request_review_comment",
      delivery: "c1",
      now: 1,
      body: {
        action: "created",
        pull_request: {
          number: 1709,
          user: { login: "togmund" },
          head: { sha: "abcdef" },
        },
        comment: {
          id: 9,
          user: { login: "eadmundo" },
          path: "services/a.ts",
          line: 224,
          body: "The season resolves from the wrong row.",
        },
      },
    })
    const draft = Result.getOrUndefined(inboxFor({ event, actor: "github:togmund" }))
    expect(draft?.kind).toBe("turn")
    expect(draft?.text).toContain("eadmundo commented on #1709")
    expect(Result.isFailure(inboxFor({ event, actor: "github:eadmundo" }))).toBe(true)
  })

  it("turns a Linear comment into a turn, and can ignore the actor's own", () => {
    const event = fromLinear({
      delivery: "lc1",
      now: 1,
      body: {
        type: "Comment",
        action: "create",
        data: {
          body: "Can you check the season rollup?",
          issue: { identifier: "DEV-1506" },
          user: { name: "Ed" },
        },
      },
    })
    expect(event).toMatchObject({
      kind: "comment.created",
      ticket: "DEV-1506",
      author: "Ed",
    })
    const draft = Result.getOrUndefined(inboxFor({ event, actor: "github:togmund" }))
    expect(draft?.kind).toBe("turn")
    expect(draft?.ticket).toBe("DEV-1506")
    expect(Result.isFailure(inboxFor({ event, actor: "github:togmund", linearUser: "Ed" }))).toBe(
      true,
    )
  })

  it("turns a label into a card, not a turn", () => {
    const event = fromGithub({
      event: "pull_request",
      delivery: "l1",
      now: 1,
      body: {
        action: "labeled",
        pull_request: {
          number: 1710,
          user: { login: "eadmundo" },
          head: { sha: "abcdef" },
          labels: [{ name: "multi-season" }],
        },
        label: { name: "multi-season" },
      },
    })
    expect(Result.getOrUndefined(inboxFor({ event, actor: "github:togmund" }))?.kind).toBe("card")
  })
})

describe("ledger", () => {
  it("property: every successful claim advances the epoch", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (times) => {
        const store = ledger()
        let epoch = 0
        for (let index = 0; index < times; index += 1) {
          const outcome = store.claim("c", "a@x", "github:a", 60_000, 1_000 + index * 1_000)
          if (outcome.ok) epoch = outcome.epoch
        }
        return epoch === times
      }),
    )
  })

  it("fences a claim by host and epoch", () => {
    const store = ledger()
    expect(store.claim("c", "a@x", "github:a", 60_000, 1_000)).toEqual({ ok: true, epoch: 1 })
    expect(store.claim("c", "b@x", "github:b", 60_000, 2_000)).toMatchObject({
      ok: false,
      reason: "held",
    })
    expect(store.claim("c", "a@x", "github:a", 60_000, 3_000)).toEqual({ ok: true, epoch: 2 })
  })

  it("frees an expired claim but still advances the epoch", () => {
    const store = ledger()
    store.claim("c", "a@x", "github:a", 1_000, 1_000)
    expect(store.claim("c", "b@x", "github:b", 60_000, 5_000)).toEqual({ ok: true, epoch: 2 })
  })

  it("dedupes a webhook receipt by delivery id", () => {
    const store = ledger()
    const receipt = { id: "d1", room: store.room, at: 1, kind: "review.requested" }
    expect(store.append(receipt)).toBe(true)
    expect(store.append(receipt)).toBe(false)
  })

  it("enqueues a job once per id", () => {
    const store = ledger()
    expect(store.enqueue(job("pr:1:abc"))).toBe(true)
    expect(store.enqueue(job("pr:1:abc"))).toBe(false)
  })

  it("counts the deliveries the label scoped away, and only those", () => {
    const store = ledger()
    expect(store.unrouted()).toBe(0)
    store.append({ id: "d1#unrouted", room: store.room, at: 1, kind: "review.unrouted" })
    store.append({ id: "d2", room: store.room, at: 2, kind: "review.requested" })
    expect(store.unrouted()).toBe(1)
  })

  it("claims a queued job and reports an interrupted one as claimed, not done", () => {
    const store = ledger()
    store.enqueue(job("pr:1:abc"))
    const claimed = Result.getOrUndefined(store.claimJob("a@x", 10))
    expect(claimed?.state).toBe("claimed")
    expect(store.jobs()[0]?.state).toBe("claimed")
  })
})

describe("a room with no Linear project", () => {
  const bound: RoomConfig = {
    ...CONFIG,
    name: "platform-upgrade",
    room: "linear:p@local/togmund",
    watch: { label: "maintenance" },
  }

  const build = (options: Partial<InitOptions>) =>
    initRoomConfig({
      options: {
        name: "platform-upgrade",
        projectId: undefined,
        projectName: undefined,
        workspace: undefined,
        label: undefined,
        linearUser: undefined,
        now: 2,
        ...options,
      },
      stage: "local/togmund",
      repo: { owner: "o", name: "r" },
      root: ".",
      previous: undefined,
    })

  it("addresses the room by its label, and stops polling Linear", () => {
    const config = build({ label: "maintenance" })
    expect(config.room).toBe("github:maintenance@local/togmund")
    expect(config.project).toEqual({ kind: "github", id: "maintenance", name: "maintenance" })
    expect(config.ingress).toEqual({ github: "forward", linear: "none" })
    // The label is both the address and the label a PR carries: dropping it from `watch` would
    // leave the room blind to the workstream it is named after.
    expect(config.watch).toEqual({ label: "maintenance" })
  })

  it("refuses a room with no address at all, and half a Linear project", () => {
    expect(
      addressRefusal({ projectId: undefined, projectName: undefined, label: undefined }),
    ).toContain("--label")
    expect(addressRefusal({ projectId: "p", projectName: undefined, label: undefined })).toContain(
      "go together",
    )
    expect(
      addressRefusal({ projectId: undefined, projectName: undefined, label: "x" }),
    ).toBeUndefined()
    // A project *and* a label is a project room with a watched label, which is fully addressed.
    expect(addressRefusal({ projectId: "p", projectName: "n", label: "x" })).toBeUndefined()
  })

  it("keeps the address a --force rewrite was given, when the flags are silent", () => {
    // The flags that created the config are the ones a re-run is most likely to omit; dropping
    // them turned a rebind into "a room needs an address".
    expect(
      resolveAddress({
        projectId: undefined,
        projectName: undefined,
        label: undefined,
        previous: bound,
      }),
    ).toEqual({ projectId: "p", projectName: "p", label: "maintenance" })
    expect(
      resolveAddress({
        projectId: undefined,
        projectName: undefined,
        label: undefined,
        previous: build({ label: "maintenance" }),
      }).label,
    ).toBe("maintenance")
  })

  it("resets the ingress when the address changes kind, and keeps it when it does not", () => {
    const options = {
      name: "platform-upgrade",
      projectId: undefined,
      projectName: undefined,
      workspace: undefined,
      label: "maintenance",
      linearUser: undefined,
      now: 2,
    }
    const labeled = build({ label: "maintenance" })
    // A label room says `linear: none`; carrying that into a project room would silence the
    // project's own ingress, so an address that changes kind goes back to that kind's default.
    const rebound = initRoomConfig({
      options: {
        ...options,
        label: undefined,
        projectId: "p",
        projectName: "p",
      },
      stage: "local/togmund",
      repo: { owner: "o", name: "r" },
      root: ".",
      previous: { ...labeled, ingress: { github: "forward", linear: "none" } },
    })
    expect(rebound.room).toBe("linear:p@local/togmund")
    expect(rebound.ingress.linear).toBe("poll")
    // Same address kind: the ingress is a decision, and a rewrite keeps it.
    const again = initRoomConfig({
      options,
      stage: "local/togmund",
      repo: { owner: "o", name: "r" },
      root: ".",
      previous: { ...labeled, ingress: { github: "poll", linear: "none" } },
    })
    expect(again.ingress).toEqual({ github: "poll", linear: "none" })
  })
})

describe("who is driving", () => {
  const claim = {
    sessionId: "01a18442",
    worktree: "/Users/t/seed-stack",
    host: "macbook",
    attachedAt: 1_000,
  }

  it("names the session and its worktree, not the machine", () => {
    expect(renderDriver({ driver: claim, now: 1_000 + 2 * 3_600_000 })).toBe(
      "driving 01a18442 · seed-stack · 2h ago",
    )
    expect(renderDriver({ driver: undefined, now: 0 })).toContain("driving nobody")
    expect(worktreeName("/Users/t/seed-stack/")).toBe("seed-stack")
  })

  it("records the worktree the caller is in, not the directory the room config lives in", () => {
    expect(claimedWorktree({ explicit: "/w/explicit", toplevel: "/w/top", root: "/repo" })).toBe(
      "/w/explicit",
    )
    expect(claimedWorktree({ explicit: undefined, toplevel: "/w/seed-stack", root: "/repo" })).toBe(
      "/w/seed-stack",
    )
    // No git (or a bare directory): the room's root is still better than nothing.
    expect(claimedWorktree({ explicit: undefined, toplevel: undefined, root: "/repo" })).toBe(
      "/repo",
    )
  })

  it("takes the caller from the host's session id, then from the terminal", () => {
    expect(callerOf({ explicit: "given", env: { PI_SESSION_ID: "env" }, machine: "m" })).toBe(
      "given",
    )
    expect(callerOf({ explicit: undefined, env: { PI_SESSION_ID: "env" }, machine: "m" })).toBe(
      "env",
    )
    expect(callerOf({ explicit: undefined, env: { USER: "togmund" }, machine: "m" })).toBe(
      "togmund@m",
    )
  })

  it("refuses a second speaker, and names the one word that overrides it", () => {
    const refusal = sayRefusal({ driver: claim, caller: "01a1ac87", now: 1_000, takeOver: false })
    expect(refusal).toContain("01a18442")
    expect(refusal).toContain("seed-stack")
    expect(refusal).toContain("--take-over")
    expect(
      sayRefusal({ driver: claim, caller: "01a18442", now: 1_000, takeOver: false }),
    ).toBeUndefined()
    expect(
      sayRefusal({ driver: claim, caller: "01a1ac87", now: 1_000, takeOver: true }),
    ).toBeUndefined()
    expect(
      sayRefusal({ driver: undefined, caller: "01a1ac87", now: 1_000, takeOver: false }),
    ).toBeUndefined()
  })

  it("lets an expired claim stop being authoritative", () => {
    const day = 24 * 60 * 60_000
    expect(renderDriver({ driver: claim, now: claim.attachedAt + day })).toContain("stale")
    // A session that disconnected 21 hours ago must not refuse a live one.
    expect(
      sayRefusal({
        driver: claim,
        caller: "01a1ac87",
        now: claim.attachedAt + 21 * 3_600_000,
        takeOver: false,
      }),
    ).toBeUndefined()
    // Inside the TTL the claim still holds.
    expect(
      sayRefusal({
        driver: claim,
        caller: "01a1ac87",
        now: claim.attachedAt + 3_600_000,
        takeOver: false,
      }),
    ).toContain("01a18442")
  })

  it("keeps one room per checkout: a rebind replaces the entry at the same config path", async () => {
    const home = mkdtempSync(join(tmpdir(), "room-index-"))
    const previous = process.env.ROOM_HOME
    process.env.ROOM_HOME = home
    const record = (room: string, name: string) =>
      Effect.runPromise(
        recordRoom({
          room,
          name,
          projectId: room,
          stage: "local/t",
          configPath: "/repo/room.config.json",
          lastSeen: 1,
        }).pipe(Effect.provide(NodeServices.layer)),
      )
    try {
      await record("linear:a@local/t", "data-migration-v1")
      await record("linear:b@local/t", "seed-generator")
      const index = await Effect.runPromise(readIndex.pipe(Effect.provide(NodeServices.layer)))
      // Two entries pointing at one config path is an entry that lies: the old name would read
      // the new room's config and show it under the old name.
      expect(index.rooms.map((entry) => entry.name)).toEqual(["seed-generator"])
    } finally {
      if (previous === undefined) delete process.env.ROOM_HOME
      else process.env.ROOM_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("survives a restart because the claim is a file, and a release leaves none", async () => {
    const home = mkdtempSync(join(tmpdir(), "room-driver-"))
    const previous = process.env.ROOM_HOME
    process.env.ROOM_HOME = home
    try {
      await Effect.runPromise(writeDriver(CONFIG, claim).pipe(Effect.provide(NodeServices.layer)))
      expect(
        await Effect.runPromise(readDriver(CONFIG).pipe(Effect.provide(NodeServices.layer))),
      ).toEqual(claim)
      await Effect.runPromise(releaseDriver(CONFIG).pipe(Effect.provide(NodeServices.layer)))
      expect(
        await Effect.runPromise(readDriver(CONFIG).pipe(Effect.provide(NodeServices.layer))),
      ).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.ROOM_HOME
      else process.env.ROOM_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })
})
