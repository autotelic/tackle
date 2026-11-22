import { Option, Predicate } from "effect"
import type { Session, Workstream } from "./presence.ts"

/*
 * The repo panel is a projection of `/presence` and nothing else. Every count below is
 * derived from the document in front of it; no field is cached and no age comes from
 * the browser clock — the board's `observedAt` is the "now" ages are measured against.
 *
 * The instants stay internal: the view needs a sentence, not a number, and a caller that
 * could pick the number apart would be a second place deciding what "observed" means.
 * Absence travels as Option inside this module — "no cursor advanced" and "adopted at the
 * epoch" are different facts, and only one of them is unobserved.
 */

/** A repo is the panel around its workstreams. `unfiled` holds the ones the document
 *  did not name a repo for; they are a section, never a dropped row. */
export interface RepoPanel {
  readonly repo: string
  readonly workstreams: ReadonlyArray<Workstream>
  readonly live: number
  readonly unobserved: number
  /** The latest adoption instant among the unobserved: the moment after which nobody
   *  in this bucket has looked. The earliest would understate workstreams adopted later. */
  readonly unobservedSince: Option.Option<number>
  readonly pullRequests: number
}

/** The section a workstream lands in when the document carries no repo for it. */
export const UNFILED = "unfiled"

/** `Date.parse` answers NaN for "", for a bare date and for prose; all three are "no instant". */
const instantOf = (value: string | undefined): Option.Option<number> => {
  if (value === undefined || value.trim() === "") return Option.none()
  const at = Date.parse(value)
  return Number.isNaN(at) ? Option.none() : Option.some(at)
}

/** "Now" as the document states it: the instant the board read the sources. */
const observedNow = (observedAt: string): Option.Option<number> => instantOf(observedAt)

const someInstants = (options: ReadonlyArray<Option.Option<number>>): ReadonlyArray<number> =>
  options.flatMap((option) => (Option.isSome(option) ? [option.value] : []))

/**
 * The newest instant any cursor reached, or none when none advanced.
 *
 * An empty cursor is the store's "never advanced", so a freshly adopted workstream is
 * unobserved — not observed at the epoch, and not stale.
 */
const lastObserved = (workstream: Workstream): Option.Option<number> => {
  const cursors = workstream.cursors
  if (cursors === undefined) return Option.none()
  const instants = someInstants([
    instantOf(cursors.github),
    instantOf(cursors.linear),
    instantOf(cursors.reports),
  ])
  return instants.length === 0 ? Option.none() : Option.some(Math.max(...instants))
}

/** When the workstream entered the factory: adoption, or the checkpoint that stood in for it. */
const adoptedInstant = (workstream: Workstream): Option.Option<number> =>
  Option.firstSomeOf([instantOf(workstream.createdAt), instantOf(workstream.checkpoint?.at)])

/** No source has been read since adoption: this is the freshness of the document,
 *  not of the people (see `groupByRepo` for the bucket the panel counts). */
export const isUnobserved: Predicate.Predicate<Workstream> = (workstream) =>
  Option.isNone(lastObserved(workstream))

/** The repo of the record, or the section that keeps an unnamed one visible. */
export const repoOf = (workstream: Workstream): string => {
  const repo = workstream.repo?.trim()
  return repo === undefined || repo === "" ? UNFILED : repo
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** The weekday an instant fell on, in UTC so two machines read the same document alike. */
const weekdayOf = (at: number): string => WEEKDAYS[new Date(at).getUTCDay()] ?? "unknown day"

/**
 * An age with its unit, never a bare number and never `0m`: under a minute is "just now",
 * because a rounded zero reads as "nothing happened".
 */
export const ageLabel = (input: { readonly at: number; readonly now: number }): string => {
  const seconds = Math.floor((input.now - input.at) / 1_000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + "m ago"
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h ago"
  const days = Math.floor(hours / 24)
  if (days < 7) return days + "d ago"
  return Math.floor(days / 7) + "w ago"
}

/** Group workstreams by repo, keeping the document's own order inside each panel. */
export const groupByRepo = (
  workstreams: ReadonlyArray<Workstream>,
  sessions: ReadonlyArray<Session>,
): ReadonlyArray<RepoPanel> => {
  const repos: Array<string> = []
  for (const workstream of workstreams) {
    const repo = repoOf(workstream)
    if (!repos.includes(repo)) repos.push(repo)
  }
  // `unfiled` sorts last: it is the tail of the page, not a repository name.
  repos.sort((left, right) => {
    if (left === UNFILED) return 1
    if (right === UNFILED) return -1
    return left.localeCompare(right)
  })
  // A session names the workstream it is attached to; the set is read once for every panel.
  const liveIds = new Set(
    sessions.flatMap((session) => (session.workstream === undefined ? [] : [session.workstream])),
  )
  return repos.map((repo) => {
    const inRepo = workstreams.filter((workstream) => repoOf(workstream) === repo)
    // "live" and "unobserved" are read together in one sentence, so they must partition:
    // a workstream with a session attached is being looked at now, whatever the cursors say.
    const unobserved = inRepo.filter(
      (workstream) => !liveIds.has(workstream.id) && isUnobserved(workstream),
    )
    const adoptions = someInstants(unobserved.map((workstream) => adoptedInstant(workstream)))
    return {
      repo,
      workstreams: inRepo,
      live: inRepo.filter((workstream) => liveIds.has(workstream.id)).length,
      unobserved: unobserved.length,
      unobservedSince: adoptions.length === 0 ? Option.none() : Option.some(Math.max(...adoptions)),
      pullRequests: inRepo.filter((workstream) => workstream.pr !== undefined).length,
    }
  })
}

const plural = (input: {
  readonly count: number
  readonly one: string
  readonly many: string
}): string => input.count + " " + (input.count === 1 ? input.one : input.many)

/** The checkpoint's age suffix, or nothing when either side has no instant to measure. */
export const checkpointAge = (input: {
  readonly at: string
  readonly observedAt: string
}): string => {
  const at = instantOf(input.at)
  const now = observedNow(input.observedAt)
  return Option.isSome(at) && Option.isSome(now)
    ? " · " + ageLabel({ at: at.value, now: now.value })
    : ""
}

/** The freshness sentence for one workstream: live, observed, or unobserved — never "0m". */
export const observationLabel = (input: {
  readonly workstream: Workstream
  readonly observedAt: string
  readonly live: boolean
}): string => {
  if (input.live) return "live now — no source read yet"
  const observed = lastObserved(input.workstream)
  const now = observedNow(input.observedAt)
  if (Option.isNone(observed)) return "not observed — no cursor advanced"
  // A document that cannot age itself still says it was observed; it just cannot date it.
  return Option.isSome(now)
    ? "observed " + ageLabel({ at: observed.value, now: now.value })
    : "observed"
}

/** The unobserved clause, always with its denominator: "all observed" is a count of the same set. */
export const unobservedClause = (input: {
  readonly panel: RepoPanel
  readonly observedAt: string
}): string => {
  if (input.panel.unobserved === 0) return "all observed"
  const count = input.panel.unobserved + " unobserved"
  // No adoption instant is a fact about the document, not a reason to drop the count.
  if (Option.isNone(input.panel.unobservedSince)) return count + ", adoption instant unknown"
  const since = input.panel.unobservedSince.value
  const now = observedNow(input.observedAt)
  // A document that cannot age itself still reports the count; it just cannot date it.
  if (Option.isNone(now)) return count
  return now.value - since >= 86_400_000
    ? count + " since " + weekdayOf(since)
    : count + ", last looked " + ageLabel({ at: since, now: now.value })
}

/**
 * The repo header as a sentence: what the panel is, and how much of it nobody has looked at.
 *
 *   `acme/web · 3 workstreams (1 live, 2 unobserved since Tue) · 1 PR`
 *
 * Pull requests are counted, not typed: `/presence` carries the number and the phase, never
 * GitHub's merged flag, so the sentence does not claim one.
 */
export const repoLine = (input: {
  readonly panel: RepoPanel
  readonly observedAt: string
}): string =>
  [
    input.panel.repo,
    plural({
      count: input.panel.workstreams.length,
      one: "workstream",
      many: "workstreams",
    }) +
      " (" +
      input.panel.live +
      " live, " +
      unobservedClause(input) +
      ")",
    plural({ count: input.panel.pullRequests, one: "PR", many: "PRs" }),
  ].join(" · ")

/** The gate slot: named, because a repo panel without its gate is not silently gated. */
export const GATE_MISSING =
  "gate: not in /presence · missing baseline identity count, error and warning counts, newest accepted identity"

/** The PR state slot: the number is on the wire, open-versus-merged is GitHub's. */
export const PR_STATE_MISSING =
  "PR state: not in /presence · a PR number is served, but whether it is open or merged is GitHub's"
