import { Option } from "effect"
import type { Cursors, Workstream } from "./presence.ts"

/*
 * Ages and the three freshness values. `unobserved` means nobody looked, not that
 * nothing happened, so it never collapses into `fresh` or into a numeric zero.
 */

export type Freshness = "fresh" | "stale" | "unobserved"

/** A source cursor older than this is stale, even if a pass is running. */
export const FRESH_WINDOW_MS = 15 * 60_000

/** Two missed 20-second polls: the page is no longer showing current data. */
export const POLL_STALE_AFTER_MS = 45_000

/** Parse an instant, treating missing and malformed values as "no observation". */
const instantOption = (value: string | null | undefined): Option.Option<number> =>
  Option.flatMap(Option.fromNullishOr(value), (text) => {
    const trimmed = text.trim()
    const at = Date.parse(trimmed)
    return trimmed === "" || Number.isNaN(at) ? Option.none() : Option.some(at)
  })

/** An age with its unit. Seconds are exact, so a sub-minute age never truncates to `0m`. */
export const ageLabel = (input: { readonly at: number; readonly now: number }): string => {
  const seconds = Math.max(0, Math.floor((input.now - input.at) / 1_000))
  if (seconds < 60) return seconds + "s ago"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + "m ago"
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h ago"
  const days = Math.floor(hours / 24)
  if (days < 7) return days + "d ago"
  return Math.floor(days / 7) + "w ago"
}

/** An instant's age, or none when there was no instant to age. */
const ageAtOption = (input: {
  readonly at: string | null | undefined
  readonly now: number
}): Option.Option<string> =>
  Option.map(instantOption(input.at), (at) => ageLabel({ at, now: input.now }))

/** An instant's age, or undefined when there was no instant to age. */
export const ageAt = (input: { readonly at: string | null | undefined; readonly now: number }) =>
  Option.getOrUndefined(ageAtOption(input))

/** Freshness for an instant already parsed, used by the page's own poll state. */
export const freshnessOfInstant = (input: {
  readonly at: number | null | undefined
  readonly now: number
  readonly windowMs?: number | undefined
}): Freshness => {
  if (input.at === null || input.at === undefined) return "unobserved"
  return input.now - input.at <= (input.windowMs ?? FRESH_WINDOW_MS) ? "fresh" : "stale"
}

/** One source's freshness: nobody looked, looked recently, or looked too long ago. */
export const freshnessOf = (input: {
  readonly at: string | null | undefined
  readonly now: number
  readonly windowMs?: number | undefined
}): Freshness =>
  freshnessOfInstant({
    at: Option.getOrUndefined(instantOption(input.at)),
    now: input.now,
    windowMs: input.windowMs,
  })

export interface SourceFreshness {
  readonly github: Freshness
  readonly linear: Freshness
  readonly reports: Freshness
}

/** Each factory source, so "nobody looked" is never hidden inside an overall value. */
export const sourceFreshness = (input: {
  readonly cursors: Cursors | undefined
  readonly now: number
}): SourceFreshness => ({
  github: freshnessOf({ at: input.cursors?.github, now: input.now }),
  linear: freshnessOf({ at: input.cursors?.linear, now: input.now }),
  reports: freshnessOf({ at: input.cursors?.reports, now: input.now }),
})

/** One workstream's freshness across its three sources. */
export const workstreamFreshness = (input: {
  readonly workstream: Workstream
  readonly now: number
}): Freshness => {
  const sources = sourceFreshness({ cursors: input.workstream.cursors, now: input.now })
  return overallFreshness([sources.github, sources.linear, sources.reports])
}

/** The aggregate of several freshness values. Any stale source makes the panel stale. */
export const overallFreshness = (values: ReadonlyArray<Freshness>): Freshness => {
  if (values.every((value) => value === "unobserved")) return "unobserved"
  return values.every((value) => value === "fresh" || value === "unobserved") ? "fresh" : "stale"
}

/** `no checkpoint yet` for an absent checkpoint; a named commit and its age otherwise. */
export const checkpointLabel = (input: {
  readonly checkpoint: Workstream["checkpoint"]
  readonly now: number
}): string => {
  if (input.checkpoint === null || input.checkpoint === undefined) return "no checkpoint yet"
  const sha = input.checkpoint.sha.trim()
  const name = sha === "" ? "checkpoint unknown" : "checkpoint " + sha.slice(0, 8)
  return Option.match(ageAtOption({ at: input.checkpoint.at, now: input.now }), {
    onNone: () => name,
    onSome: (age) => name + " · " + age,
  })
}

/** `observed 4s ago`, or `unobserved`; never a zero without a source. */
export const observedLabel = (input: {
  readonly at: string | null | undefined
  readonly now: number
}): string =>
  Option.match(ageAtOption(input), {
    onNone: () => "unobserved",
    onSome: (age) => "observed " + age,
  })
