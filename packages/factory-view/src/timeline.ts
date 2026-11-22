import { Data, Option, Schema } from "effect"
import { formatAge } from "./age.ts"

/** The wire shape the factory serves at `factory.activity[].timeline`. */
export const TimelineEvent = Schema.Struct({
  kind: Schema.Literals(["pass", "checkpoint", "ship"]),
  at: Schema.String,
  endedAt: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["running", "done", "failed"])),
  pass: Schema.optional(Schema.Finite),
  sha: Schema.optional(Schema.String),
})
export type TimelineEvent = typeof TimelineEvent.Type

export const Timeline = Schema.Struct({ events: Schema.Array(TimelineEvent) })
export type Timeline = typeof Timeline.Type

/** The default axis: one day, because "is this moving?" is a today question. */
export const WINDOW_HOURS = 24

const HOUR_MS = 60 * 60 * 1000

// Absence stays internal; the public axis makes "no observation" its own value.
const instantOf = (value: string | null | undefined): Option.Option<number> => {
  if (value === null || value === undefined) return Option.none()
  const at = Date.parse(value)
  return Number.isFinite(at) ? Option.some(at) : Option.none()
}

/** The strip's right edge: the board's observation, or the fact that it has none. */
export type TimelineAxis = Data.TaggedEnum<{
  readonly Observed: { readonly at: number }
  readonly Unobserved: {}
}>

const TimelineAxis = Data.taggedEnum<TimelineAxis>()

/**
 * Read the board's observation instant as the axis end.
 *
 * @param value - the presence document's `observedAt`.
 * @returns the observed instant, or Unobserved rather than a guessed clock.
 */
export const axisOf = (value: string | null | undefined): TimelineAxis => {
  const at = Option.getOrUndefined(instantOf(value))
  return at === undefined ? TimelineAxis.Unobserved() : TimelineAxis.Observed({ at })
}

/** An event and where it sits in the window: 0 is the left edge, 1 the right. */
export interface Mark {
  readonly event: TimelineEvent
  readonly offset: number
}

/**
 * Keep the events the strip can draw and place each one on the axis.
 *
 * An event without a readable instant, or outside the window, is dropped. An
 * empty result is the strip's "nothing to say" value, never an error.
 *
 * @param input - the events, the axis end, and an optional window in hours.
 * @returns the drawable marks, in source order.
 */
export const marksWithin = (input: {
  readonly events: ReadonlyArray<TimelineEvent>
  readonly end: number
  readonly windowHours?: number | undefined
}): ReadonlyArray<Mark> => {
  const window = (input.windowHours ?? WINDOW_HOURS) * HOUR_MS
  const start = input.end - window
  const marks: Array<Mark> = []
  for (const event of input.events) {
    const at = Option.getOrUndefined(instantOf(event.at))
    if (at === undefined || at < start || at > input.end) continue
    marks.push({ event, offset: (at - start) / window })
  }
  return marks
}

const countedNouns = {
  pass: ["pass", "passes"],
  checkpoint: ["checkpoint", "checkpoints"],
  ship: ["ship", "ships"],
} as const

/**
 * Name what the strip shows for a screen reader.
 *
 * @param marks - the marks the strip will draw.
 * @param windowHours - the axis width, defaulting to the strip's own.
 * @returns a sentence with one count per lane.
 */
export const timelineLabel = (
  marks: ReadonlyArray<Mark>,
  windowHours: number = WINDOW_HOURS,
): string => {
  const counts = { pass: 0, checkpoint: 0, ship: 0 }
  for (const mark of marks) counts[mark.event.kind] += 1
  const parts = (["pass", "checkpoint", "ship"] as const).flatMap((lane) => {
    const count = counts[lane]
    const nouns = countedNouns[lane]
    return count === 0 ? [] : [count + " " + (count === 1 ? nouns[0] : nouns[1])]
  })
  return parts.length === 0
    ? "No activity in the last " + windowHours + " hours"
    : "Last " + windowHours + " hours: " + parts.join(", ")
}

const ageOf = (at: string, end: number): string => {
  const instant = Option.getOrUndefined(instantOf(at))
  return instant === undefined
    ? "unknown"
    : formatAge(Math.max(0, Math.round((end - instant) / 60_000)))
}

const durationOf = (event: TimelineEvent): Option.Option<string> => {
  const ended = instantOf(event.endedAt)
  return Option.all([instantOf(event.at), ended]).pipe(
    Option.filter(([start, end]) => end >= start),
    Option.map(([start, end]) => {
      const minutes = Math.round((end - start) / 60_000)
      return minutes < 1 ? "under a minute" : minutes + "m"
    }),
  )
}

/**
 * What a mark says when hovered: its number, outcome, duration and age.
 *
 * @param event - the timeline mark.
 * @param end - the axis end, so the age has its denominator.
 * @returns the one-line description.
 */
export const describeEvent = (event: TimelineEvent, end: number): string => {
  const age = ageOf(event.at, end)
  if (event.kind === "pass") {
    const id = event.pass === undefined ? "pass" : "pass #" + event.pass
    const duration = Option.match(durationOf(event), {
      onNone: () => "",
      onSome: (value) => " in " + value,
    })
    return id + " " + (event.status ?? "unknown") + duration + " · " + age
  }
  const sha = event.sha === undefined ? "" : " " + event.sha.slice(0, 8)
  return event.kind + sha + " · " + age
}
