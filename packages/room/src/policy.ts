import { Predicate } from "effect"
import { actorOf, jobOf, type Job, type RoomId } from "@autotelic/board"
import type { RoomEvent } from "./ingest.ts"

/*
 * The review policy, in one function.
 *
 * Two ways to be addressed. A review request names a person; a labeled PR names the project.
 * The label is the ambient version: Ed opens a PR carrying the room's label and the room
 * acts, whether or not anyone clicked "request review". The author check keeps the room from
 * reviewing its own actor's work.
 *
 * `synchronize` is deliberately absent: a push is not a request for another review. A person
 * or a thread decides when the next pass happens.
 */

/** The events that can open a review job. */
type ReviewEvent =
  | Extract<RoomEvent, { kind: "review.requested" }>
  | Extract<RoomEvent, { kind: "pr.ready" }>

/**
 * Whether this event asks this room for a review.
 *
 * @param input - The event, the room's actor, and the project label it watches.
 * @returns True when the event is addressed to this room.
 */
export const shouldReview: Predicate.Predicate<{
  readonly event: RoomEvent
  readonly actor: string
  readonly label?: string
}> = ({ event, actor, label }) => {
  if (event.kind === "review.requested") {
    return !event.draft && event.reviewer !== "" && actorOf(event.reviewer) === actor
  }
  if (event.kind === "pr.ready") {
    return (
      label !== undefined &&
      label !== "" &&
      event.labels.includes(label) &&
      actorOf(event.author) !== actor &&
      !event.draft
    )
  }
  return false
}

/**
 * The job a review event creates.
 *
 * @param input - The review event, the room, and the instant.
 * @returns The queued job, deduplicated by PR head.
 */
export const reviewJob = ({
  event,
  room,
  now,
}: {
  readonly event: ReviewEvent
  readonly room: RoomId
  readonly now: number
}): Job => ({
  id: jobOf({ pr: event.pr, sha: event.sha }),
  room,
  kind: "review",
  pr: event.pr,
  sha: event.sha,
  state: "queued",
  attempts: 0,
  createdAt: now,
  updatedAt: now,
})
