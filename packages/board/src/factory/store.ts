import { Data } from "effect"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/** The phases a workstream can be in. `blocked` is a state, never a crash. */
export const Phase = Schema.Literals(["reconcile", "build", "compress", "land", "blocked", "done"])
export type Phase = typeof Phase.Type

export const Gate = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
})

export const Gates = Schema.Struct({
  perPass: Schema.Array(Gate),
  onReady: Schema.Array(Gate),
})

/**
 * The room a workstream's passes run in.
 *
 * A reference, never a second worktree: `path` is the adopted checkout and
 * `docs/workstream.md` rule 2 says it never changes, so a binding whose room resolves to a
 * different directory is refused rather than silently becoming the place the worker runs.
 */
export const RoomBinding = Schema.Struct({
  id: Schema.String,
  root: Schema.String,
})
export type RoomBinding = typeof RoomBinding.Type

/**
 * The four things a finished pass can be, as the session that started it hears them.
 *
 * They are four different questions: did it finish (done), does a human have to answer
 * (blocked, gate), did it break (failed). A pass is one of them, never a sentence.
 */
export const NotifyOutcome = Schema.Literals(["done", "blocked", "gate", "failed"])
export type NotifyOutcome = typeof NotifyOutcome.Type

/**
 * Where a finished pass reports: one Pi/intercom session, and which outcomes it wants.
 *
 * `factory status` is pull; this is the push edge that stops the chief asking every ten
 * minutes. Absent is a workstream nobody is told about, which is what every record written
 * before this field is.
 */
export const Notify = Schema.Struct({
  session: Schema.String,
  outcomes: Schema.optional(Schema.Array(NotifyOutcome)),
})
export type Notify = typeof Notify.Type

/**
 * Every outcome notifies unless the record narrows it.
 *
 * All four by default because a pass already ends rarely: at most one message per pass is
 * written, so "done" is one line at the end of the pass that finished the work, not a stream.
 * A chief that wants attention only passes `--notify-outcomes blocked,gate,failed`.
 */
export const defaultNotifyOutcomes: ReadonlyArray<NotifyOutcome> = [
  "done",
  "blocked",
  "gate",
  "failed",
]

export const Workstream = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  project: Schema.String,
  linearProjectId: Schema.optional(Schema.String),
  linearUrl: Schema.optional(Schema.String),
  worker: Schema.optional(Schema.String),
  /** The room this workstream's passes occupy; absent is a workstream with no room. */
  room: Schema.optional(RoomBinding),
  /** The session a finished pass reports to; absent is a workstream nobody is told about. */
  notify: Schema.optional(Notify),
  label: Schema.String,
  repo: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  head: Schema.String,
  delivery: Schema.optional(Schema.Literals(["pr", "trunk"])),
  pr: Schema.optional(Schema.Finite),
  base: Schema.String,
  baseSha: Schema.String,
  prHead: Schema.String,
  diverged: Schema.Boolean,
  phase: Phase,
  deps: Schema.Array(Schema.String),
  lease: Schema.Struct({
    holder: Schema.String,
    generation: Schema.Finite,
    expiresAt: Schema.optional(Schema.String),
  }),
  cursors: Schema.Struct({
    github: Schema.String,
    linear: Schema.String,
    reports: Schema.optional(Schema.String),
  }),
  budgets: Schema.Struct({
    passesPerPhase: Schema.Finite,
    wallMinutesPerPass: Schema.Finite,
    tokensPerDay: Schema.Finite,
    roundsOfChanges: Schema.Finite,
  }),
  gates: Schema.optional(Gates),
  conventions: Schema.optional(
    Schema.Struct({
      path: Schema.String,
      sha: Schema.String,
      at: Schema.String,
    }),
  ),
  readiness: Schema.optional(
    Schema.Struct({
      at: Schema.String,
      ok: Schema.Boolean,
      head: Schema.optional(Schema.String),
      checks: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          command: Schema.String,
          exit: Schema.Finite,
          durationMs: Schema.Finite,
          output: Schema.String,
          failure: Schema.optional(Schema.String),
          failureKind: Schema.optional(
            Schema.Literals(["ok", "load-error", "timeout", "test-timeout", "failed"]),
          ),
          failures: Schema.optional(Schema.Array(Schema.String)),
          timeoutMs: Schema.optional(Schema.Finite),
        }),
      ),
    }),
  ),
  autonomy: Schema.Array(Schema.String),
  desk: Schema.Array(Schema.Unknown),
  sources: Schema.optional(
    Schema.Array(Schema.Struct({ kind: Schema.Literal("reports"), dir: Schema.String })),
  ),
  protectedPaths: Schema.optional(Schema.Array(Schema.String)),
  checkpoint: Schema.Struct({
    sha: Schema.String,
    ref: Schema.String,
    at: Schema.String,
    pushed: Schema.Boolean,
  }),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Workstream = typeof Workstream.Type

export class WorkstreamDecodeError extends Data.TaggedError("WorkstreamDecodeError")<{
  readonly path: string
  readonly detail: string
}> {}

export interface Facts {
  readonly project: string
  readonly linearProjectId?: string | undefined
  readonly linearUrl?: string | undefined
  readonly worker?: string | undefined
  readonly room?: RoomBinding | undefined
  readonly notify?: Notify | undefined
  readonly label: string
  readonly repo: string
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly delivery: "pr" | "trunk"
  readonly pr: number | undefined
  readonly sources?: ReadonlyArray<{ readonly kind: "reports"; readonly dir: string }> | undefined
  readonly base: string
  readonly baseSha: string
  readonly prHead: string
  readonly phase: Phase
  readonly at: string
  readonly checkpoint: Workstream["checkpoint"]
}

/** The root for workstream records, outside every governed repository. */
export const factoryHome = (): string => process.env.FACTORY_HOME ?? join(homedir(), ".factory")

/** The one-landing-at-a-time lock, shared by ready and the pass kernel. */
export const landingLock = (home?: string | undefined): string =>
  join(home ?? factoryHome(), "ready.lock")

/**
 * The directory holding every workstream record.
 *
 * @param home - the factory home, defaults to FACTORY_HOME or ~/.factory.
 * @returns the workstreams directory.
 */
export const workstreamDir = (home: string = factoryHome()): string => join(home, "workstreams")

/**
 * The file for one workstream record.
 *
 * @param input - the workstream id and optional home.
 * @returns the record path.
 */
export const workstreamFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(workstreamDir(input.home), input.id + ".json")

const decode = (input: { readonly text: string; readonly path: string }): Workstream => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Workstream))(input.text)
  if (Result.isFailure(decoded))
    throw new WorkstreamDecodeError({ path: input.path, detail: String(decoded.failure) })
  return decoded.success
}

/** Read one workstream; absence is undefined, malformed is a typed error. */
export const readWorkstream = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<Workstream | undefined> => {
  const path = workstreamFile(input)
  const text = await readFile(path, "utf8").catch(() => undefined)
  return text === undefined ? undefined : decode({ text, path })
}

/** A record the board could not decode; it must be visible, not silently absent. */
export interface WorkstreamIssue {
  readonly id: string
  readonly path: string
  readonly detail: string
}

/** Every record that failed to decode, in file order. */
export const listWorkstreamIssues = async (input?: {
  readonly home?: string | undefined
}): Promise<ReadonlyArray<WorkstreamIssue>> => {
  const dir = workstreamDir(input?.home)
  const names = await readdir(dir).catch(() => [])
  const issues: Array<WorkstreamIssue> = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.endsWith(".json")) continue
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(Workstream))(text)
    if (Result.isSuccess(decoded)) continue
    issues.push({
      id: name.slice(0, -5),
      path: join(dir, name),
      detail: String(decoded.failure).slice(0, 500),
    })
  }
  return issues
}

/** Every decodable workstream, in id order; one malformed file does not hide the rest. */
export const listWorkstreams = async (input?: { readonly home?: string | undefined }) => {
  const dir = workstreamDir(input?.home)
  const names = await readdir(dir).catch(() => [])
  const records: Array<Workstream> = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.endsWith(".json")) continue
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(Workstream))(text)
    if (Result.isSuccess(decoded)) records.push(decoded.success)
  }
  return records
}

/** Write atomically: a crash never leaves a half record. */
export const writeWorkstream = async (input: {
  readonly record: Workstream
  readonly home?: string | undefined
  /** Operator writes are authoritative even if a pass wrote a later timestamp. */
  readonly control?: boolean | undefined
}): Promise<void> => {
  await mkdir(workstreamDir(input.home), { recursive: true })
  const current = await readWorkstream({ id: input.record.id, home: input.home })
  // A pass holds its start record for minutes. If an operator edited settings while it ran,
  // the pass must merge them back rather than clobber them with its stale copy. The pass owns
  // head/checkpoint/PR fields; the operator owns the controls here.
  const stale =
    input.control !== true &&
    current !== undefined &&
    Date.parse(current.updatedAt) > Date.parse(input.record.updatedAt)
  const record: Workstream = stale
    ? {
        ...input.record,
        budgets: current.budgets,
        // The binding is an operator control written by adopt, like the budgets: a pass that
        // started before a rebind must not write its stale copy back over the new one.
        room: current.room,
        notify: current.notify,
        desk: current.desk,
        phase: current.phase,
        cursors: current.cursors,
        gates: current.gates,
        conventions: current.conventions,
        readiness: current.readiness,
        autonomy: current.autonomy,
        protectedPaths: current.protectedPaths,
        updatedAt: current.updatedAt,
      }
    : input.record
  const path = workstreamFile({ id: record.id, home: input.home })
  const temporary = path + ".tmp"
  await writeFile(temporary, JSON.stringify(record, null, 2) + "\n")
  await rename(temporary, path)
}

/**
 * A path as the filesystem names it.
 *
 * Adoption, the branch guard and the room binding all ask "is this the same checkout", so they
 * compare paths one way: realpath, never string equality.
 */
export const canonicalPath = (path: string): string => {
  // SAFETY: realpath is a filesystem boundary; a missing path is resolved lexically.
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Find a workstream that already owns this path or this PR.
 *
 * @param input - the records and the candidate path, repo and PR.
 * @returns the owner, or none when both are free.
 */
export type Collision = Data.TaggedEnum<{
  readonly Free: {}
  readonly Owned: { readonly workstream: Workstream }
}>

const Collision = Data.taggedEnum<Collision>()

/**
 * The workstream that owns a worktree path, if any. Adoption and the branch guard both ask
 * this question, so they compare paths one way: realpath, not string equality.
 *
 * @param input - the records and the worktree path.
 * @returns Owned with the record, or Free when no record governs the path.
 */
export const ownerOfPath = (input: {
  readonly records: ReadonlyArray<Workstream>
  readonly path: string
}): Collision => {
  const path = canonicalPath(input.path)
  const found = input.records.find((record) => canonicalPath(record.path) === path)
  return found === undefined ? Collision.Free() : Collision.Owned({ workstream: found })
}

/**
 * Find a workstream that already owns this path or this PR.
 *
 * @param input - the records and the candidate path, repo and PR.
 * @returns Free, or the owning workstream.
 */
export const collision = (input: {
  readonly records: ReadonlyArray<Workstream>
  readonly path: string
  readonly repo: string
  readonly branch: string
  readonly pr: number | undefined
}): Collision => {
  const pathOwner = ownerOfPath({ records: input.records, path: input.path })
  if (pathOwner._tag === "Owned") return pathOwner
  const found = input.records.find(
    (record) =>
      (input.pr !== undefined && record.repo === input.repo && record.pr === input.pr) ||
      (record.repo === input.repo && record.branch === input.branch),
  )
  return found === undefined ? Collision.Free() : Collision.Owned({ workstream: found })
}

/** Build a record from observed git/PR facts. */
export const recordOf = (input: { readonly id: string; readonly facts: Facts }): Workstream => ({
  version: 1,
  id: input.id,
  project: input.facts.project,
  linearProjectId: input.facts.linearProjectId,
  linearUrl: input.facts.linearUrl,
  worker: input.facts.worker,
  room: input.facts.room,
  notify: input.facts.notify,
  label: input.facts.label,
  repo: input.facts.repo,
  path: resolve(input.facts.path),
  branch: input.facts.branch,
  head: input.facts.head,
  delivery: input.facts.delivery,
  pr: input.facts.pr,
  base: input.facts.base,
  baseSha: input.facts.baseSha,
  prHead: input.facts.prHead,
  diverged: input.facts.head !== input.facts.prHead,
  phase: input.facts.phase,
  deps: [],
  lease: { holder: process.env.HOSTNAME ?? "local", generation: 1 },
  cursors: {
    github: input.facts.delivery === "trunk" ? input.facts.at : "",
    linear: "",
    reports: input.facts.delivery === "trunk" ? input.facts.at : undefined,
  },
  budgets: {
    // A hard ceiling, not a normal stop: progress is judged by the receipt signature. It is
    // deliberately high so a productive branch never turns a human into a budget button.
    passesPerPhase: 100,
    wallMinutesPerPass: 30,
    tokensPerDay: 0,
    roundsOfChanges: 2,
  },
  // Build-only by default. Verification is declared onReady, not run per commit.
  gates: { perPass: [], onReady: [] },
  autonomy: ["comment", "label", "push", "pr-body", "rebase", "ci-fix", "adopt-commits"],
  desk: [],
  sources:
    input.facts.delivery === "trunk"
      ? (input.facts.sources ?? [{ kind: "reports" as const, dir: "~/.factory/reports" }])
      : undefined,
  protectedPaths:
    input.facts.delivery === "trunk"
      ? [
          ".jig-baseline.json",
          "jig.config.json",
          "package.json",
          "pnpm-workspace.yaml",
          "oxlint.config.ts",
          "packages/board/src/factory/**",
        ]
      : undefined,
  checkpoint: input.facts.checkpoint,
  createdAt: input.facts.at,
  updatedAt: input.facts.at,
})
