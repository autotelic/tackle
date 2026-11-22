/* oxlint-disable plumb/prefer-property-tests -- one fixed presence document per claim. */
import type { Model } from "../src/main.ts"

/** A fixed observation instant, so every offset in the tests is exact. */
export const NOW = Date.parse("2026-11-21T22:50:00.000Z")

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

/**
 * An instant this far before the fixed observation.
 *
 * @param milliseconds - how long before NOW the instant sits.
 * @returns the ISO timestamp the document would carry.
 */
export const ago = (milliseconds: number): string => new Date(NOW - milliseconds).toISOString()

type Presence = NonNullable<Model["presence"]>
export type Workstream = Presence["factory"]["workstreams"][number]
export type Activity = Presence["factory"]["activity"][number]
export type TimelineEvent = NonNullable<Activity["timeline"]>["events"][number]

/** The mutable builder for a pass mark; optional fields are added only when known. */
interface PassEvent {
  kind: "pass"
  at: string
  status: "running" | "done" | "failed"
  pass: number
  endedAt?: string
  sha?: string
}

/**
 * One workstream in the presence document.
 *
 * @param input - the id, phase, checkpoint instant and optional sha.
 * @returns the workstream the view decodes.
 */
export const workstreamOf = (input: {
  readonly id: string
  readonly phase?: string
  readonly checkpointAt: string
  readonly sha?: string
}): Workstream => ({
  id: input.id,
  project: "P-AUT-128",
  label: input.id,
  phase: input.phase ?? "build",
  path: "/work/" + input.id,
  repo: "acme/web",
  branch: "feature/" + input.id,
  checkpoint: { sha: input.sha ?? "9f1c2ab8", at: input.checkpointAt },
})

/**
 * One activity entry carrying a timeline.
 *
 * @param input - the workstream id, its events, and an optional last-pass instant.
 * @returns the activity the view decodes.
 */
export const activityFor = (input: {
  readonly workstream: string
  readonly events: ReadonlyArray<TimelineEvent>
  readonly lastPassAt?: string
}): Activity => ({
  workstream: input.workstream,
  lastPass:
    input.lastPassAt === undefined
      ? null
      : {
          pass: 1,
          at: input.lastPassAt,
          status: "done",
          phase: "build",
          events: [],
        },
  timeline: { events: input.events },
  pending: [],
  lastEvent: null,
  ageMinutes: 1,
})

/**
 * A pass mark, with its end and receipt sha when known.
 *
 * @param input - the start, number, outcome and optional end and sha.
 * @returns the timeline event.
 */
export const pass = (input: {
  readonly at: string
  readonly pass: number
  readonly status: "running" | "done" | "failed"
  readonly endedAt?: string
  readonly sha?: string
}): TimelineEvent => {
  const event: PassEvent = { kind: "pass", at: input.at, status: input.status, pass: input.pass }
  if (input.endedAt !== undefined) event.endedAt = input.endedAt
  if (input.sha !== undefined) event.sha = input.sha
  return event
}

/**
 * A checkpoint mark.
 *
 * @param input - the instant and the checkpoint sha.
 * @returns the timeline event.
 */
export const checkpoint = (input: {
  readonly at: string
  readonly sha: string
}): TimelineEvent => ({
  kind: "checkpoint",
  at: input.at,
  sha: input.sha,
})

/**
 * A ship mark.
 *
 * @param input - the instant and the shipped sha.
 * @returns the timeline event.
 */
export const ship = (input: { readonly at: string; readonly sha: string }): TimelineEvent => ({
  kind: "ship",
  at: input.at,
  sha: input.sha,
})

/**
 * A complete model with one presence document.
 *
 * @param input - the observation instant, workstreams and their activity.
 * @returns the view model.
 */
export const modelOf = (input: {
  readonly observedAt: string
  readonly workstreams: ReadonlyArray<Workstream>
  readonly activities: ReadonlyArray<Activity>
}): Model => ({
  presence: {
    observedAt: input.observedAt,
    factory: {
      workstreams: [...input.workstreams],
      activity: [...input.activities],
      desk: [],
      reports: [],
    },
    sessions: {
      herdr: { available: false, sessions: [] },
      rex: { available: false, sessions: [] },
    },
  },
  error: null,
  loading: false,
  notice: null,
})
