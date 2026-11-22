import { readFile, readdir } from "node:fs/promises"
import { Option } from "effect"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { readEvents, type Event } from "./events.ts"
import { passesUsed, receiptsDir, type Receipt } from "./kernel.ts"
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

export interface Activity {
  readonly workstream: string
  readonly lastPass: ActivityPass | null
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
  readonly budget: { readonly used: number; readonly passesPerPhase: number }
  readonly phase: Workstream["phase"]
  readonly state: "working" | "queued" | "blocked" | "idle" | "done"
  readonly blockedBy: ReadonlyArray<string>
}

const minutesSince = (at: string, now: number): number =>
  Math.max(0, Math.round((now - Date.parse(at)) / 60_000))

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
  const used = await passesUsed({ id: input.record.id, home: input.home })
  const capped = pending.length > 0 && used >= input.record.budgets.passesPerPhase
  const state =
    input.record.phase === "done"
      ? ("done" as const)
      : lastPass?.status === "running"
        ? ("working" as const)
        : input.record.phase === "blocked" || capped
          ? ("blocked" as const)
          : pending.length > 0
            ? ("queued" as const)
            : ("idle" as const)
  const blockedBy =
    input.record.phase === "blocked"
      ? ["phase:blocked"]
      : capped
        ? ["budget:passes " + used + "/" + input.record.budgets.passesPerPhase]
        : []
  return {
    workstream: input.record.id,
    lastPass,
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
    budget: { used, passesPerPhase: input.record.budgets.passesPerPhase },
    phase: input.record.phase,
    state,
    blockedBy,
  }
}
