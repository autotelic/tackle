import { readFile, readdir } from "node:fs/promises"
import { Option } from "effect"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { readEvents, type Event } from "./events.ts"
import { receiptsDir, type Receipt } from "./kernel.ts"
import { Phase, type Workstream } from "./store.ts"

const Quality = Schema.Struct({
  available: Schema.Boolean,
  errors: Schema.Finite,
  warnings: Schema.Finite,
  note: Schema.String,
})

const StoredPass = Schema.Struct({
  workstream: Schema.String,
  pass: Schema.Finite,
  at: Schema.String,
  endedAt: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "done", "failed"]),
  phase: Phase,
  events: Schema.Array(Schema.String),
  checkpoint: Schema.optional(Schema.String),
  exit: Schema.optional(Schema.Finite),
  quality: Schema.optional(
    Schema.Struct({ before: Quality, after: Quality, regressed: Schema.Boolean }),
  ),
  journal: Schema.optional(Schema.String),
})

const EventSummary = Schema.Struct({
  actual: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
})

const summaryOf = (event: Event): Option.Option<string> => {
  const decoded = Schema.decodeUnknownResult(EventSummary)(event.payload)
  if (Result.isFailure(decoded)) return Option.none()
  const text =
    decoded.success.actual ??
    decoded.success.task ??
    decoded.success.title ??
    decoded.success.body ??
    decoded.success.command
  return text === undefined ? Option.none() : Option.some(text.slice(0, 160))
}

export type ActivityPass = Omit<Receipt, "workstream" | "journal">

/** One mark on a workstream's time strip; the view never reads a receipt itself. */
export interface TimelineEvent {
  readonly kind: "pass" | "checkpoint" | "ship"
  readonly at: string
  readonly endedAt?: string | undefined
  readonly status?: "running" | "done" | "failed" | undefined
  readonly pass?: number | undefined
  readonly sha?: string | undefined
}

/** Everything a one-day strip needs, in the order it happened. */
export interface Timeline {
  readonly events: ReadonlyArray<TimelineEvent>
}

export interface Activity {
  readonly workstream: string
  readonly lastPass: ActivityPass | null
  readonly timeline: Timeline
  readonly pending: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly at: string
    readonly summary: string | undefined
  }>
  readonly lastEvent: {
    readonly id: string
    readonly kind: string
    readonly at: string
    readonly summary: string | undefined
  } | null
  readonly ageMinutes: number | null
}

const minutesSince = (at: string, now: number): number =>
  Math.max(0, Math.round((now - Date.parse(at)) / 60_000))

const kindOrder = { pass: 0, checkpoint: 1, ship: 2 } as const

/**
 * Project receipts, the current checkpoint and a closed phase onto one axis.
 *
 * The kernel has no separate ship instant: `phase: done` is its closed flag and
 * `updatedAt` is when the record was last written, so that is the marker.
 */
const timelineOf = (input: {
  readonly record: Workstream
  readonly passes: ReadonlyArray<ActivityPass>
}): Timeline => {
  const events: Array<TimelineEvent> = []
  for (const pass of input.passes) {
    events.push({
      kind: "pass",
      at: pass.at,
      endedAt: pass.endedAt,
      status: pass.status,
      pass: pass.pass,
      sha: pass.checkpoint,
    })
    if (pass.checkpoint !== undefined)
      events.push({
        kind: "checkpoint",
        at: pass.endedAt ?? pass.at,
        pass: pass.pass,
        sha: pass.checkpoint,
      })
  }
  const checkpoint = input.record.checkpoint
  const carried = events.some(
    (event) => event.kind === "checkpoint" && event.sha === checkpoint.sha,
  )
  if (!carried) events.push({ kind: "checkpoint", at: checkpoint.at, sha: checkpoint.sha })
  if (input.record.phase === "done")
    events.push({ kind: "ship", at: input.record.updatedAt, sha: checkpoint.sha })
  events.sort(
    (left, right) =>
      left.at.localeCompare(right.at) || kindOrder[left.kind] - kindOrder[right.kind],
  )
  return { events }
}

/**
 * Summarize what a workstream is doing from its receipts and pending events.
 *
 * @param input - the workstream, optional home, and a clock for the age.
 * @returns the last pass, queued events, and how stale the last activity is.
 */
export const activityOf = async (input: {
  readonly record: Workstream
  readonly home?: string | undefined
  readonly now: number
}): Promise<Activity> => {
  const directory = receiptsDir({ id: input.record.id, home: input.home })
  const names = (await readdir(directory).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))
  const passes: Array<ActivityPass> = []
  for (const name of names) {
    const text = await readFile(join(directory, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(StoredPass))(text)
    if (Result.isFailure(decoded)) continue
    const base = {
      pass: decoded.success.pass,
      at: decoded.success.at,
      endedAt: decoded.success.endedAt,
      status: decoded.success.status,
      phase: decoded.success.phase,
      events: decoded.success.events,
      checkpoint: decoded.success.checkpoint,
      exit: decoded.success.exit,
    }
    passes.push(
      decoded.success.quality === undefined ? base : { ...base, quality: decoded.success.quality },
    )
  }
  const lastPass = passes.at(-1) ?? null
  const events = await readEvents({ id: input.record.id, home: input.home }).catch(() => [])
  const pending = events
    .filter((event) => event.status === "pending")
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      at: event.at,
      summary: Option.getOrUndefined(summaryOf(event)),
    }))
  const latestEvent = events.at(-1)
  const lastAt = lastPass?.at ?? latestEvent?.at ?? input.record.checkpoint.at
  return {
    workstream: input.record.id,
    lastPass,
    timeline: timelineOf({ record: input.record, passes }),
    pending,
    lastEvent:
      latestEvent === undefined
        ? null
        : {
            id: latestEvent.id,
            kind: latestEvent.kind,
            at: latestEvent.at,
            summary: Option.getOrUndefined(summaryOf(latestEvent)),
          },
    ageMinutes: minutesSince(lastAt, input.now),
  }
}
