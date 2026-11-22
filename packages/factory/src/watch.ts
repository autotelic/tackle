import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { appendEvent, consumeEvents, readEvents } from "./events.ts"
import { passesUsed, runPass, type PassOutcome } from "./kernel.ts"
import { readWorkstream, writeWorkstream, type Workstream } from "./store.ts"
import { listAnswers, readDesk } from "./desk.ts"
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

const Github = Schema.Struct({
  headRefOid: Schema.String,
  reviews: Schema.Array(
    Schema.Struct({
      id: Schema.Finite,
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
    "reviews,comments,headRefOid",
  ])
  if (Result.isFailure(result)) return []
  const json = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(result.success)
  if (Result.isFailure(json)) return []
  const decoded = Schema.decodeUnknownResult(Github)(json.success)
  if (Result.isFailure(decoded)) return []
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
  return events
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
  const result = git(["log", "-1", "--format=%H%x00%cI%x00%s", ref])
  if (Result.isFailure(result)) return []
  const [sha, at, subject] = result.success.trim().split("\u0000")
  if (sha === undefined || at === undefined) return []
  const since = Date.parse(input.record.cursors.github || "1970-01-01T00:00:00.000Z")
  if (Date.parse(at) <= since) return []
  if (Result.isSuccess(git(["merge-base", "--is-ancestor", sha, "HEAD"]))) return []
  return [
    {
      id: "base:commit:" + sha,
      kind: "commit",
      at,
      payload: { sha, subject: subject ?? "" },
      headSha: sha,
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
  readonly worker: string
  readonly at: string
  readonly home?: string | undefined
  readonly events?: ReadonlyArray<WatchEvent>
  readonly runGh?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
  readonly runGit?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
  readonly runLinear?: ((args: ReadonlyArray<string>) => Result.Result<string, string>) | undefined
}): Promise<WatchOutcome> => {
  const record = await readWorkstream({ id: input.id, home: input.home })
  if (record === undefined) return { appended: [], passes: [] }
  const polled = [
    ...githubEvents({ record, runGh: input.runGh }),
    ...baseEvents({ record, runGit: input.runGit }),
    ...linearEvents({ record, runLinear: input.runLinear }),
    ...(await reportEvents({ record })),
    ...(await deskEvents({ record, home: input.home })),
  ]
  const candidates = input.events ?? polled
  const readExisting = await readEvents({ id: input.id, home: input.home })
  const own = readExisting
    .filter(
      (event) => event.status === "pending" && ownCommit({ event, record, runGit: input.runGit }),
    )
    .map((event) => event.id)
  if (own.length > 0) await consumeEvents({ id: input.id, ids: own, home: input.home })
  const existing =
    own.length === 0 ? readExisting : await readEvents({ id: input.id, home: input.home })
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
    const decision = shouldWake({
      record,
      event,
      consumed,
      passesUsed: used + passes.length,
    })
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
        const key = event.id.startsWith("linear:")
          ? "linear"
          : event.id.startsWith("github:") || event.id.startsWith("base:")
            ? "github"
            : null
        if (key !== null)
          await writeWorkstream({
            record: {
              ...current,
              cursors: { ...current.cursors, [key]: event.at },
              updatedAt: input.at,
            },
            home: input.home,
          })
      }
    }
  }
  return { appended, passes }
}
