import { Option } from "effect"
import { passesUsed } from "@autotelic/factory/kernel"
import type { Workstream } from "@autotelic/factory/store"

/*
 * `/presence` is the read surface, so the board computes the fields a human reads once
 * and puts them in the document. The view never recomputes freshness or a pass count
 * from a second source; it renders what is here.
 */

export type Freshness = "fresh" | "stale" | "unobserved"
export type CapStop = "passes" | "wallMinutes" | "tokens" | "rounds"

/** The freshness window. A cursor older than this is stale, even if a pass is running. */
export const FRESH_WINDOW_MS = 15 * 60_000

const instantOf = (value: string | undefined): Option.Option<number> => {
  if (value === undefined || value.trim() === "") return Option.none()
  const at = Date.parse(value)
  return Number.isNaN(at) ? Option.none() : Option.some(at)
}

/**
 * One source's freshness: nobody looked, looked recently, or looked too long ago.
 *
 * @param input - the cursor instant and the board's observation instant.
 * @returns the three-valued freshness.
 */
export const freshnessOf = (input: {
  readonly cursor: string | undefined
  readonly observedAt: string
  readonly windowMs?: number
}): Freshness => {
  const cursor = instantOf(input.cursor)
  const now = instantOf(input.observedAt)
  if (Option.isNone(cursor) || Option.isNone(now)) return "unobserved"
  return now.value - cursor.value <= (input.windowMs ?? FRESH_WINDOW_MS) ? "fresh" : "stale"
}

const overall = (sources: {
  readonly github: Freshness
  readonly linear: Freshness
  readonly reports: Freshness
}): Freshness => {
  const values = [sources.github, sources.linear, sources.reports]
  if (values.every((value) => value === "unobserved")) return "unobserved"
  if (values.every((value) => value === "fresh" || value === "unobserved")) return "fresh"
  return "stale"
}

const cursorOf = (value: string | undefined): Option.Option<string> =>
  value === undefined || value.trim() === "" ? Option.none() : Option.some(value)

/**
 * The dependency ids that are not shipped: one hop, and the id itself is the fact.
 *
 * @param record - the workstream whose deps are read.
 * @param records - every workstream the board can see, used to test `phase: done`.
 * @returns the blocking ids, in the record's own order.
 */
export const blockedByOf = (input: {
  readonly record: Workstream
  readonly records: ReadonlyArray<Workstream>
}): ReadonlyArray<string> =>
  input.record.deps.filter((id) => {
    const dependency = input.records.find((candidate) => candidate.id === id)
    return dependency === undefined || dependency.phase !== "done"
  })

export interface WorkstreamView {
  readonly observed: {
    readonly github: string | null
    readonly linear: string | null
    readonly reports: string | null
  }
  readonly freshness: Freshness
  readonly freshnessBySource: {
    readonly github: Freshness
    readonly linear: Freshness
    readonly reports: Freshness
  }
  readonly blockedBy: ReadonlyArray<string>
  readonly budget: {
    readonly passes: { readonly used: number; readonly of: number }
    readonly capStop: CapStop | null
  }
}

/**
 * Add the fields the panel reads to one workstream record.
 *
 * @param input - the record, its siblings, the observation instant and its charged passes.
 * @returns the record plus observed, freshness, blockedBy and budget.
 */
export const enrichWorkstream = (input: {
  readonly record: Workstream
  readonly records: ReadonlyArray<Workstream>
  readonly observedAt: string
  readonly used: number
}): Workstream & WorkstreamView => {
  const sources = {
    github: freshnessOf({ cursor: input.record.cursors.github, observedAt: input.observedAt }),
    linear: freshnessOf({ cursor: input.record.cursors.linear, observedAt: input.observedAt }),
    reports: freshnessOf({ cursor: input.record.cursors.reports, observedAt: input.observedAt }),
  }
  const of = input.record.budgets.passesPerPhase
  return {
    ...input.record,
    observed: {
      github: Option.getOrNull(cursorOf(input.record.cursors.github)),
      linear: Option.getOrNull(cursorOf(input.record.cursors.linear)),
      reports: Option.getOrNull(cursorOf(input.record.cursors.reports)),
    },
    freshness: overall(sources),
    freshnessBySource: sources,
    blockedBy: blockedByOf(input),
    budget: {
      passes: { used: input.used, of },
      capStop: input.used >= of ? "passes" : null,
    },
  }
}

/**
 * Enrich every workstream, counting each one's charged receipts.
 *
 * @param input - the records, the observation instant and the optional factory home.
 * @returns the records in their original order, each carrying its computed fields.
 */
export const observeWorkstreams = async (input: {
  readonly records: ReadonlyArray<Workstream>
  readonly observedAt: string
  readonly home?: string | undefined
}): Promise<ReadonlyArray<Workstream & WorkstreamView>> =>
  Promise.all(
    input.records.map(async (record) =>
      enrichWorkstream({
        record,
        records: input.records,
        observedAt: input.observedAt,
        used: await passesUsed({ id: record.id, home: input.home }),
      }),
    ),
  )
