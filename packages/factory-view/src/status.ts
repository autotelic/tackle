import { Match, Option } from "effect"
import type { Budget, Freshness, Observed, Session, Workstream } from "./presence.ts"

/*
 * The panel's sentences, derived only from `/presence`. Ages use the document's own
 * `observedAt` so two readers of one document read the same ages, and every absence
 * has a word: `no checkpoint yet`, `never`, `unknown`. A numeric zero is only ever a
 * real count with its denominator beside it.
 */

const instantOf = (value: string | null | undefined): Option.Option<number> => {
  if (value === null || value === undefined || value.trim() === "") return Option.none()
  const at = Date.parse(value)
  return Number.isNaN(at) ? Option.none() : Option.some(at)
}

/** An age with its unit, never `0m`: a rounded zero reads as "nothing happened". */
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

/** The age of one instant, or none when either side is not an instant. */
const ageFrom = (input: {
  readonly at: string | null | undefined
  readonly observedAt: string
}): Option.Option<string> => {
  const at = instantOf(input.at)
  const now = instantOf(input.observedAt)
  return Option.isNone(at) || Option.isNone(now)
    ? Option.none()
    : Option.some(ageLabel({ at: at.value, now: now.value }))
}

/** `no checkpoint yet`, or the commit with its age. Never a number without its denominator. */
export const checkpointLabel = (input: {
  readonly checkpoint: Workstream["checkpoint"]
  readonly observedAt: string
}): string => {
  if (input.checkpoint === null) return "no checkpoint yet"
  const sha = input.checkpoint.sha.slice(0, 8)
  return Option.match(ageFrom({ at: input.checkpoint.at, observedAt: input.observedAt }), {
    onNone: () => "checkpoint " + sha,
    onSome: (age) => "checkpoint " + sha + " · " + age,
  })
}

/** `3/5 passes`, or the cap stop with its dimension and counts. */
export const budgetLabel = (budget: Budget | undefined): string => {
  if (budget === undefined) return "budget unknown"
  const noun = budget.passes.of === 1 ? "pass" : "passes"
  return budget.capStop === null
    ? budget.passes.used + "/" + budget.passes.of + " " + noun
    : "cap stop: " + budget.capStop + " " + budget.passes.used + "/" + budget.passes.of
}

/** The ids that block this workstream; absence is unknown, `[]` is genuinely unblocked. */
export const blockedByLabel = (ids: ReadonlyArray<string> | undefined): string => {
  if (ids === undefined) return "blockedBy unknown"
  if (ids.length === 0) return "not blocked by another workstream"
  return "blocked by " + ids.join(", ")
}

/** A single freshness value as a word; the three values stay distinguishable. */
export const freshnessLabel = (freshness: Freshness | undefined): string => freshness ?? "unknown"

/** Each source's freshness, so "nobody looked" is never hidden inside an overall value. */
export const sourceFreshnessLabel = (ws: Workstream): string => {
  const sources = ws.freshnessBySource
  if (sources === undefined) return "sources unknown"
  return (
    "github " + sources.github + " · linear " + sources.linear + " · reports " + sources.reports
  )
}

/** The newest source observation, aged; `observed: never` is not `0m`. */
export const observedLabel = (input: {
  readonly observed: Observed | undefined
  readonly observedAt: string
}): string => {
  const observed = input.observed
  if (observed === undefined) return "observed: unknown"
  const instants = [observed.github, observed.linear, observed.reports]
    .map((value) => instantOf(value))
    .filter(Option.isSome)
    .map((value) => value.value)
  if (instants.length === 0) return "observed: never"
  const now = instantOf(input.observedAt)
  return Option.isNone(now)
    ? "observed"
    : "observed " + ageLabel({ at: Math.max(...instants), now: now.value })
}

/** One source's age, or `never` when its cursor has not advanced. */
export const sourceAgeLabel = (input: {
  readonly at: string | null | undefined
  readonly observedAt: string
}): string =>
  Option.getOrElse(ageFrom({ at: input.at, observedAt: input.observedAt }), () => "never")

/** The short name shown in the time strip's pass ticks. */
export const sessionCommand = (session: Session): string =>
  session.source === "herdr" ? "hc attach " + session.address : "rex block focus " + session.address

export type PrFlag = "merged" | "open" | "closed" | "none" | "unknown"
export type ProjectFlag = "completed" | "started" | "planned" | "canceled" | "unknown"

export interface ClosedFlags {
  readonly phase: "done" | "open"
  readonly pr: PrFlag
  readonly project: ProjectFlag
  /** All three flags, kept separate: `phase done · PR 1862 open · project started`. */
  readonly line: string
  /** The disagreement a person needs to see, or null when the flags agree. */
  readonly warning: string | null
}

const prFlagOf = (workstream: Workstream): PrFlag => {
  if (workstream.pr === undefined) return workstream.delivery === "trunk" ? "none" : "unknown"
  const state = workstream.prState
  return state === undefined || state === null ? "unknown" : state
}

const projectFlagOf = (workstream: Workstream): ProjectFlag => {
  const state = workstream.projectState
  return state === undefined || state === null ? "unknown" : state
}

/**
 * The three closed flags, kept separate because their disagreement is the useful state.
 *
 * @param workstream - one workstream from `/presence`.
 * @returns the flags, a line naming each, and the warning when they disagree.
 */
export const closedFlags = (workstream: Workstream): ClosedFlags => {
  const phase = workstream.phase === "done" ? "done" : "open"
  const pr = prFlagOf(workstream)
  const project = projectFlagOf(workstream)
  const prName = workstream.pr === undefined ? "no PR" : "PR " + workstream.pr
  const line = "phase " + phase + " · " + prName + " " + pr + " · project " + project
  const warnings: Array<string> = []

  if (phase === "done" && pr !== "merged") {
    const reason = Match.value(pr).pipe(
      Match.when("open", () => " — ready for a person, not finished"),
      Match.when("unknown", () => " — cannot tell whether GitHub merged"),
      Match.orElse(() => " — the kernel stopped before the PR did"),
    )
    warnings.push("phase done · " + prName + " " + pr + reason)
  }
  if (phase === "open" && pr === "merged") {
    warnings.push(
      "PR " +
        workstream.pr +
        " merged · phase " +
        workstream.phase +
        " — GitHub says landed, kernel still open",
    )
  }
  if (phase === "open" && project === "completed") {
    warnings.push(
      "project completed · phase " +
        workstream.phase +
        " — Linear says finished, kernel still open",
    )
  }
  if (phase === "done" && project === "unknown") {
    warnings.push("phase done · project unknown — cannot tell whether Linear completed")
  }
  if (phase === "done" && project !== "completed" && project !== "unknown") {
    warnings.push("phase done · project " + project + " — Linear still open")
  }
  if (phase === "open" && project === "unknown" && pr === "merged") {
    warnings.push("PR merged · project unknown — cannot tell whether Linear completed")
  }

  return {
    phase,
    pr,
    project,
    line,
    warning: warnings.length === 0 ? null : warnings.join(" · "),
  }
}
