import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Option } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { appendEvent, consumeEvents, readEvents } from "./events.ts"
import { isProtectedPath, passesUsed, runPass, type PassOutcome } from "./kernel.ts"
import { readWorkstream, writeWorkstream, type Workstream } from "./store.ts"
import { answerDesk, listAnswers, listDesk, raiseDesk, readDesk } from "./desk.ts"
import { Report } from "./report.ts"

/** A source event already normalized to the shape the kernel consumes. */
export const WatchEvent = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  at: Schema.String,
  payload: Schema.Unknown,
  headSha: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
})
export type WatchEvent = typeof WatchEvent.Type

const Check = Schema.Struct({
  __typename: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
  workflowName: Schema.optional(Schema.NullOr(Schema.String)),
  targetUrl: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
})

const Github = Schema.Struct({
  headRefOid: Schema.String,
  baseRefOid: Schema.optional(Schema.String),
  mergeable: Schema.optional(Schema.String),
  mergeStateStatus: Schema.optional(Schema.String),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  mergeCommit: Schema.optional(Schema.NullOr(Schema.Struct({ oid: Schema.String }))),
  statusCheckRollup: Schema.optional(Schema.NullOr(Schema.Array(Check))),
  reviews: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.String,
      body: Schema.optional(Schema.String),
      submittedAt: Schema.optional(Schema.String),
      author: Schema.optional(Schema.Struct({ login: Schema.String })),
    }),
  ),
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.Finite,
      body: Schema.String,
      createdAt: Schema.String,
      author: Schema.optional(Schema.Struct({ login: Schema.String })),
    }),
  ),
})

const LinearIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  updatedAt: Schema.String,
  project: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.String })),
})

const run = (input: { readonly command: string; readonly args: ReadonlyArray<string> }) => {
  const result = spawnSync(input.command, [...input.args], { encoding: "utf8" })
  return result.status === 0 && result.error === undefined
    ? Result.succeed(result.stdout)
    : Result.fail((result.stderr || String(result.error)).trim())
}

/** Read GitHub reviews and issue comments after the cursor. */
export const githubEvents = (input: {
  readonly record: Workstream
  readonly runGh?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
  readonly at: string
}): ReadonlyArray<WatchEvent> => {
  if (input.record.pr === undefined) return []
  const gh = input.runGh ?? ((args) => run({ command: process.env.GH_BIN ?? "gh", args }))
  const result = gh([
    "pr",
    "view",
    String(input.record.pr),
    "--repo",
    input.record.repo,
    "--json",
    "reviews,comments,headRefOid,baseRefOid,mergeable,mergeStateStatus,state,mergedAt,mergeCommit,statusCheckRollup",
  ])
  if (Result.isFailure(result)) return []
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(result.success)
  if (Result.isFailure(json)) return []
  const decoded = Schema.decodeUnknownResult(Github)(json.success)
  if (Result.isFailure(decoded)) return []
  // A merge is the one PR state that retires the workstream. Return only that event:
  // replaying the comments and checks that led to it after the merge would ask a worker
  // to change a branch whose landing is already decided.
  if (decoded.success.state === "MERGED")
    return [
      {
        id:
          "github:merged:" +
          input.record.pr +
          ":" +
          (decoded.success.mergeCommit?.oid ?? decoded.success.headRefOid),
        kind: "merged",
        at: decoded.success.mergedAt ?? input.at,
        payload: {
          pr: input.record.pr,
          headRefOid: decoded.success.headRefOid,
          mergedAt: decoded.success.mergedAt ?? input.at,
        },
        headSha: decoded.success.headRefOid,
        actor: "github",
      },
    ]

  const since = Date.parse(input.record.cursors.github || "1970-01-01T00:00:00.000Z")
  const events: Array<WatchEvent> = []
  for (const review of decoded.success.reviews) {
    if (review.submittedAt === undefined || Date.parse(review.submittedAt) <= since) continue
    events.push({
      id: "github:review:" + review.id,
      kind: "review",
      at: review.submittedAt,
      payload: { state: review.state, body: review.body ?? "" },
      headSha: decoded.success.headRefOid,
      actor: review.author?.login,
    })
  }
  for (const comment of decoded.success.comments) {
    if (Date.parse(comment.createdAt) <= since) continue
    events.push({
      id: "github:comment:" + comment.id,
      kind: "comment",
      at: comment.createdAt,
      payload: { body: comment.body },
      headSha: decoded.success.headRefOid,
      actor: comment.author?.login,
    })
  }
  const checkEvent = checkEvents({
    checks: decoded.success.statusCheckRollup ?? [],
    head: decoded.success.headRefOid,
    pr: input.record.pr,
    at: input.at,
  })
  if (Option.isSome(checkEvent)) events.push(checkEvent.value)

  // A stacked child branch must hear when its parent moved. The PR base OID is the
  // dependency watermark; a new value means the child should rebase before its next pass.
  if (
    decoded.success.baseRefOid !== undefined &&
    decoded.success.baseRefOid !== input.record.baseSha
  )
    events.push({
      id: "github:parent:" + decoded.success.baseRefOid,
      kind: "parent",
      at: input.at,
      payload: {
        base: input.record.base,
        previous: input.record.baseSha,
        baseRefOid: decoded.success.baseRefOid,
      },
      headSha: decoded.success.headRefOid,
      actor: "base",
    })

  // A conflict is a state, not a review: emit it while it is true, with an id tied to the
  // head and base so a rebase or a base move makes a new event and a consumed success does
  // not wake the same conflict again.
  const mergeable = decoded.success.mergeable
  const mergeState = decoded.success.mergeStateStatus
  if (mergeable === "CONFLICTING" || mergeState === "DIRTY") {
    const base = decoded.success.baseRefOid ?? input.record.baseSha
    events.push({
      id: "github:conflict:" + decoded.success.headRefOid + ":" + base,
      kind: "merge-conflict",
      at: input.at,
      payload: {
        pr: input.record.pr,
        headRefOid: decoded.success.headRefOid,
        baseRefOid: base,
        mergeable,
        mergeStateStatus: mergeState,
      },
      headSha: decoded.success.headRefOid,
      actor: "github",
    })
  }
  return events
}

type GithubCheck = typeof Check.Type

/** One check's state in the only vocabulary the kernel needs: pending, passed, failed. */
const checkState = (check: GithubCheck): "pending" | "passed" | "failed" => {
  const conclusion = check.conclusion?.toLowerCase()
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled")
    return "failed"
  if (conclusion === "action_required" || conclusion === "startup_failure") return "failed"
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped")
    return "passed"
  const state = check.state?.toUpperCase()
  if (state === "FAILURE" || state === "ERROR") return "failed"
  if (state === "SUCCESS") return "passed"
  return "pending"
}

const checkName = (check: GithubCheck): string => check.name ?? check.context ?? "check"

/** The instant a check last changed, used both for the event clock and for its identity. */
const checkAt = (check: GithubCheck, fallback: string): string =>
  check.completedAt ?? check.updatedAt ?? check.createdAt ?? check.startedAt ?? fallback

/**
 * A check run is a state of the head, not a comment. Emit one event when the head has a
 * failure, or when every check has finished without one, and key it by the state of the
 * checks so a re-run with the same result does not wake the same pass twice.
 *
 * Pending checks are deliberately silent: a half-finished matrix is not evidence that the
 * branch is broken or ready.
 */
const checkEvents = (input: {
  readonly checks: ReadonlyArray<GithubCheck>
  readonly head: string
  readonly pr: number
  readonly at: string
}): Option.Option<WatchEvent> => {
  const noEvent = Option.none<WatchEvent>()
  if (input.checks.length === 0) return noEvent
  const states = input.checks.map((check) => checkState(check))
  const failed = input.checks.filter((_, index) => states[index] === "failed")
  const pending = states.includes("pending")
  if (failed.length === 0 && pending) return noEvent
  const state = failed.length > 0 ? "failed" : "passed"
  const latest = input.checks
    .map((check) => checkAt(check, input.at))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  const signature = input.checks
    .map((check) => checkName(check) + "=" + checkState(check) + "@" + checkAt(check, ""))
    .sort((left, right) => left.localeCompare(right))
    .join("|")
  return Option.some({
    id: "github:check:" + input.head + ":" + state + ":" + signature,
    kind: "check",
    at: latest ?? input.at,
    payload: {
      pr: input.pr,
      headRefOid: input.head,
      state,
      failed: failed.map(checkName),
      checks: input.checks.map((check) => ({
        name: checkName(check),
        state: checkState(check),
        conclusion: check.conclusion ?? null,
        status: check.status ?? null,
        completedAt: check.completedAt ?? null,
      })),
    },
    headSha: input.head,
    actor: "github",
  })
}

/** Watch the base branch itself when the workstream has no PR to watch. */
export const baseEvents = (input: {
  readonly record: Workstream
  readonly runGit?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
}): ReadonlyArray<WatchEvent> => {
  if (input.record.delivery !== "trunk") return []
  const git =
    input.runGit ?? ((args) => run({ command: "git", args: ["-C", input.record.path, ...args] }))
  // A trunk has no PR notification; the base branch is the notification.
  git(["fetch", "origin", input.record.base])
  const remote = git(["rev-parse", "--verify", "origin/" + input.record.base])
  const ref = Result.isSuccess(remote) ? "origin/" + input.record.base : input.record.base
  const result = git(["log", "-1", "--format=%H%x00%cI%x00%an%x00%s", "--name-only", ref])
  if (Result.isFailure(result)) return []
  // The header is one NUL-separated line; --name-only writes a blank line, then one path per line.
  const [header, ...pathLines] = result.success.trim().split("\n")
  const [sha, at, author, subject] = (header ?? "").split("\u0000")
  if (sha === undefined || at === undefined) return []
  const paths = pathLines.map((line) => line.trim()).filter((line) => line !== "")
  const since = Date.parse(input.record.cursors.github || "1970-01-01T00:00:00.000Z")
  if (Date.parse(at) <= since) return []
  if (Result.isSuccess(git(["merge-base", "--is-ancestor", sha, "HEAD"]))) return []
  return [
    {
      id: "base:commit:" + sha,
      kind: "commit",
      at,
      payload: {
        sha,
        subject: subject ?? "",
        author: author ?? "",
        paths,
        protected: paths.some((path) => isProtectedPath({ record: input.record, path })),
      },
      headSha: sha,
      // The author rides in the payload; the actor stays "base" so a bot identity in the
      // commit does not silence the wake as self-authored.
      actor: "base",
    },
  ]
}

const expand = (path: string): string =>
  path.startsWith("~/") ? join(homedir(), path.slice(2)) : path

/** Read report files declared as a source; a report is an event, not an inbox. */
export const reportEvents = async (input: {
  readonly record: Workstream
}): Promise<ReadonlyArray<WatchEvent>> => {
  const sources = (input.record.sources ?? []).filter((source) => source.kind === "reports")
  const events: Array<WatchEvent> = []
  for (const source of sources) {
    const dir = expand(source.dir)
    const names = await readdir(dir).catch(() => [])
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".answer.json")) continue
      const text = await readFile(join(dir, name), "utf8").catch(() => undefined)
      if (text === undefined) continue
      const decoded = Schema.decodeResult(Schema.fromJsonString(Report))(text)
      if (Result.isFailure(decoded)) continue
      const report = decoded.success
      if (report.workstream === input.record.id) continue
      events.push({
        id: "report:" + report.id,
        kind: "report",
        at: report.at,
        payload: report,
        actor: report.workstream,
      })
    }
  }
  return events
}

/** Read human answers to this workstream's desk items; an answer is an event. */
export const deskEvents = async (input: {
  readonly record: Workstream
  readonly home?: string | undefined
}): Promise<ReadonlyArray<WatchEvent>> => {
  const events: Array<WatchEvent> = []
  for (const answer of await listAnswers({ home: input.home })) {
    const item = await readDesk({ id: answer.item, home: input.home })
    if (item === undefined || item.workstream !== input.record.id) continue
    // An answer older than the record's last transition was already accounted for;
    // replaying it on every poll would wake a pass that the human had already used.
    if (Date.parse(answer.at) <= Date.parse(input.record.updatedAt)) continue
    events.push({
      id: "desk:" + item.id + ":" + answer.at,
      kind: "desk",
      at: answer.at,
      payload: {
        item: item.id,
        title: item.title,
        choice: answer.choice,
        by: answer.by,
        body: item.body,
      },
      actor: answer.by,
    })
  }
  return events
}

/** Read Linear issue changes for this workstream's project after the cursor. */
export const linearEvents = (input: {
  readonly record: Workstream
  readonly runLinear?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
}): ReadonlyArray<WatchEvent> => {
  if (input.record.linearProjectId === undefined) return []
  const linear = input.runLinear ?? ((args) => run({ command: "linearis", args }))
  const result = linear(["issues", "list", "--limit", "250"])
  if (Result.isFailure(result)) return []
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(result.success)
  if (Result.isFailure(json)) return []
  const decoded = Schema.decodeUnknownResult(Schema.Array(LinearIssue))(json.success)
  if (Result.isFailure(decoded)) return []
  const since = Date.parse(input.record.cursors.linear || "1970-01-01T00:00:00.000Z")
  return decoded.success
    .filter(
      (issue) =>
        issue.project?.id === input.record.linearProjectId && Date.parse(issue.updatedAt) > since,
    )
    .map((issue) => ({
      id: "linear:issue:" + issue.id,
      kind: "issue",
      at: issue.updatedAt,
      payload: { identifier: issue.identifier, title: issue.title },
    }))
}

export interface WakeDecision {
  readonly wake: boolean
  readonly reason: string
}

/** The one decision that prevents loops and lost comments. */
export const shouldWake = (input: {
  readonly record: Workstream
  readonly event: WatchEvent
  readonly consumed: ReadonlyArray<string>
  readonly passesUsed: number
}): WakeDecision => {
  if (input.record.phase === "blocked") return { wake: false, reason: "blocked-on-desk" }
  if (input.record.phase === "done") return { wake: false, reason: "done" }
  if (input.consumed.includes(input.event.id)) return { wake: false, reason: "already-consumed" }
  if (input.event.actor?.endsWith("[bot]") === true) return { wake: false, reason: "self-authored" }
  if (input.passesUsed >= input.record.budgets.passesPerPhase)
    return {
      wake: false,
      reason: "cap-stopped: passes " + input.passesUsed + "/" + input.record.budgets.passesPerPhase,
    }
  return { wake: true, reason: "event" }
}

const CommitPayload = Schema.Struct({ sha: Schema.String })

/** A commit already in the worktree's history is not new work for this workstream. */
const ownCommit = (input: {
  readonly event: WatchEvent
  readonly record: Workstream
  readonly runGit?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
}): boolean => {
  if (input.event.kind !== "commit") return false
  const decoded = Schema.decodeUnknownResult(CommitPayload)(input.event.payload)
  if (Result.isFailure(decoded)) return false
  const git =
    input.runGit ?? ((args) => run({ command: "git", args: ["-C", input.record.path, ...args] }))
  return Result.isSuccess(git(["merge-base", "--is-ancestor", decoded.success.sha, "HEAD"]))
}

export interface WatchOutcome {
  readonly appended: ReadonlyArray<string>
  readonly passes: ReadonlyArray<PassOutcome>
}

/**
 * Poll both sources once, append unseen events, and start one pass per waking event.
 *
 * @param input - the workstream, worker command, timestamp, and optional source overrides.
 * @returns the appended event ids and the pass outcomes.
 */
export const watchOnce = async (input: {
  readonly id: string
  readonly worker?: string | undefined
  readonly at: string
  readonly home?: string | undefined
  readonly events?: ReadonlyArray<WatchEvent>
  readonly runGh?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
  readonly runGit?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
  readonly runLinear?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
}): Promise<WatchOutcome> => {
  const found = await readWorkstream({ id: input.id, home: input.home })
  if (found === undefined) return { appended: [], passes: [] }
  let record = found
  const polled = [
    ...githubEvents({ record, runGh: input.runGh, at: input.at }),
    ...baseEvents({ record, runGit: input.runGit }),
    ...linearEvents({ record, runLinear: input.runLinear }),
    ...(await reportEvents({ record })),
    ...(await deskEvents({ record, home: input.home })),
  ]
  const candidates = input.events ?? polled
  const readExisting = await readEvents({ id: input.id, home: input.home })
  const staleDesk = readExisting
    .filter(
      (event) =>
        event.status === "pending" &&
        event.kind === "desk" &&
        Date.parse(event.at) <= Date.parse(record.updatedAt),
    )
    .map((event) => event.id)
  const own = readExisting
    .filter(
      (event) => event.status === "pending" && ownCommit({ event, record, runGit: input.runGit }),
    )
    .map((event) => event.id)
  const retired = [...own, ...staleDesk]
  if (retired.length > 0) await consumeEvents({ id: input.id, ids: retired, home: input.home })
  const existing =
    retired.length === 0 ? readExisting : await readEvents({ id: input.id, home: input.home })
  const known = new Map(existing.map((event) => [event.id, event]))
  const queued = new Map(candidates.map((event) => [event.id, event]))
  for (const event of existing) {
    if (event.status !== "pending" || queued.has(event.id)) continue
    queued.set(event.id, { id: event.id, kind: event.kind, at: event.at, payload: event.payload })
  }
  const consumed = existing.filter((event) => event.status === "consumed").map((event) => event.id)
  const used = await passesUsed({ id: input.id, home: input.home })
  const appended: Array<string> = []
  const passes: Array<PassOutcome> = []
  for (const event of [...queued.values()].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  )) {
    const previous = known.get(event.id)
    if (previous?.status === "consumed") continue
    const answer = Schema.decodeUnknownResult(
      Schema.Struct({ choice: Schema.optional(Schema.String) }),
    )(event.payload)
    const choice = Result.isSuccess(answer) ? answer.success.choice : undefined

    // Merge and the explicit done answer retire without spending a pass. Both are
    // lifecycle events, not work: the branch is already landed or the human said stop.
    if (event.kind === "merged" || (event.kind === "desk" && choice === "done")) {
      if (record.phase !== "done") {
        record = { ...record, phase: "done", updatedAt: event.at }
        await writeWorkstream({ record, home: input.home })
      }
      // A merged PR closes the ready-to-merge question too. Leaving it pending would
      // tell the operator to merge a PR the factory has already retired.
      for (const item of await listDesk({ home: input.home })) {
        if (item.workstream !== record.id || !item.choices.includes("done")) continue
        await answerDesk({
          home: input.home,
          answer: { item: item.id, choice: "done", by: "factory", at: event.at },
        })
      }
      if (previous === undefined)
        await appendEvent({
          id: input.id,
          home: input.home,
          event: { ...event, status: "consumed" },
        })
      else await consumeEvents({ id: input.id, ids: [event.id], home: input.home })
      appended.push(event.id)
      continue
    }

    if (event.kind === "desk" && record.phase === "blocked" && choice === "resume") {
      record = { ...record, phase: "build", updatedAt: event.at }
      await writeWorkstream({ record, home: input.home })
    }
    const passesSoFar = used + passes.length
    if (event.kind === "desk" && choice === "increase-budget") {
      record = {
        ...record,
        budgets: {
          ...record.budgets,
          passesPerPhase: Math.max(record.budgets.passesPerPhase + 1, passesSoFar + 1),
        },
        updatedAt: event.at,
      }
      await writeWorkstream({ record, home: input.home })
      // The budget answer is administrative: consume it, then let the pending work event
      // run on the next poll. It must not spend the new pass on the desk answer itself.
      if (previous === undefined)
        await appendEvent({
          id: input.id,
          home: input.home,
          event: { ...event, status: "consumed" },
        })
      else await consumeEvents({ id: input.id, ids: [event.id], home: input.home })
      appended.push(event.id)
      continue
    }
    const decision = shouldWake({
      record,
      event,
      consumed,
      passesUsed: passesSoFar,
    })
    if (decision.reason.startsWith("cap-stopped")) {
      const capId = "desk-" + input.id + "-cap-" + record.budgets.passesPerPhase
      if ((await readDesk({ id: capId, home: input.home })) === undefined) {
        await raiseDesk({
          home: input.home,
          item: {
            id: capId,
            workstream: input.id,
            kind: "decision",
            title: "Pass budget reached: " + record.budgets.passesPerPhase,
            body:
              "The workstream stopped because it used all " +
              record.budgets.passesPerPhase +
              " passes. Answer increase-budget to allow one more pass, or done to retire.",
            choices: ["increase-budget", "done"],
            route: "live",
            at: event.at,
          },
        })
        console.log("factory: " + input.id + " " + decision.reason + "; desk " + capId + " raised")
      }
    }
    if (previous === undefined) {
      await appendEvent({
        id: input.id,
        home: input.home,
        event: { ...event, status: "pending" },
      })
      appended.push(event.id)
    }
    if (!decision.wake) continue
    const pass = await runPass({
      id: input.id,
      worker: input.worker,
      at: input.at,
      home: input.home,
      eventIds: [event.id],
    })
    passes.push(pass)
    if (pass.ok) {
      const current = await readWorkstream({ id: input.id, home: input.home })
      if (current !== undefined) {
        // A review or comment has a time watermark. A conflict or check is a state
        // keyed by its own event id; advancing the shared cursor past it would skip a
        // comment that arrived before the check finished.
        const key = event.id.startsWith("linear:")
          ? "linear"
          : event.id.startsWith("base:") || event.kind === "review" || event.kind === "comment"
            ? "github"
            : null
        const parent =
          event.kind === "parent"
            ? Schema.decodeUnknownResult(Schema.Struct({ baseRefOid: Schema.String }))(
                event.payload,
              )
            : undefined
        let next = { ...current, updatedAt: input.at }
        if (key !== null) next = { ...next, cursors: { ...current.cursors, [key]: event.at } }
        if (parent !== undefined && Result.isSuccess(parent))
          next = { ...next, baseSha: parent.success.baseRefOid }
        if (key !== null || (parent !== undefined && Result.isSuccess(parent)))
          await writeWorkstream({ record: next, home: input.home })
      }
    }
  }
  return { appended, passes }
}
