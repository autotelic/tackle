import { Predicate, Schema } from "effect"
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
 * A review request is the one address that names a person rather than a project, so when the
 * room watches a label the request has to carry it too. Without that, one room per project and
 * one reviewer in common meant every request in the organisation landed in whichever room
 * watched that person -- triage moved inside a session that may be mid-rebase, which is the
 * flood a room is supposed to prevent.
 *
 * `synchronize` is deliberately absent: a push is not a request for another review. A person
 * or a thread decides when the next pass happens.
 */

/** Which inbound event a room accepts as a request for a review. */
export const ReviewTriggerSchema = Schema.Literals([
  "review_requested",
  "review_submitted",
  "review_comment",
])
export type ReviewTrigger = typeof ReviewTriggerSchema.Type

/** The events that can open a review job. */
type ReviewEvent =
  | Extract<RoomEvent, { kind: "review.requested" }>
  | Extract<RoomEvent, { kind: "pr.ready" }>
  | Extract<RoomEvent, { kind: "review.submitted" }>
  | Extract<RoomEvent, { kind: "thread.created" }>

/**
 * Whether this event asks this room for a review.
 *
 * @param input - The event, the room's actor, and the project label it watches.
 * @returns True when the event is addressed to this room.
 */
export const shouldReview: Predicate.Predicate<{
  readonly event: RoomEvent
  readonly actor: string
  readonly label?: string | undefined
  readonly trigger?: ReviewTrigger | undefined
}> = ({ event, actor, label, trigger }) => {
  if (event.kind === "review.requested") {
    return (
      !event.draft &&
      event.reviewer !== "" &&
      actorOf(event.reviewer) === actor &&
      labelsMatch({ labels: event.labels, label })
    )
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
  // A submitted review is feedback, and feedback is a request for the next pass. Only
  // `changes_requested` qualifies: an approval does not ask for another review, and the room's
  // own review is excluded by the author check, so a pass cannot trigger itself.
  if (event.kind === "review.submitted") {
    return (
      trigger === "review_submitted" &&
      event.state === "changes_requested" &&
      event.reviewer !== "" &&
      actorOf(event.reviewer) !== actor &&
      labelsMatch({ labels: event.labels, label })
    )
  }
  // An inline review comment is the narrowest form of "look at this again". It is opt-in
  // (`review_comment`) because every thread would otherwise re-run the review.
  if (event.kind === "thread.created") {
    return (
      trigger === "review_comment" &&
      event.author !== "" &&
      actorOf(event.author) !== actor &&
      labelsMatch({ labels: event.labels, label })
    )
  }
  return false
}

/** Whether a PR carries the room's label, when a label is configured. */
const labelsMatch = (input: {
  readonly labels: ReadonlyArray<string>
  readonly label?: string | undefined
}): boolean => input.label === undefined || input.label === "" || input.labels.includes(input.label)

/**
 * Whether a review-shaped event belongs to another workstream: the room watches a label and the
 * PR does not carry it.
 *
 * These are counted rather than queued, and named on the board. A filter that drops events in
 * silence reads exactly like an ingress that never arrived, and the difference is the one thing
 * whoever starts the forwarder needs to know.
 *
 * @param input - The event, the room's watched label, and whether the room answered it.
 * @returns True when the event was someone else's work.
 */
export const unaddressed = (input: {
  readonly event: RoomEvent
  readonly label: string | undefined
  readonly queued: boolean
}): boolean => {
  const label = input.label
  if (input.queued || label === undefined || label === "") return false
  if (
    input.event.kind !== "review.requested" &&
    input.event.kind !== "pr.ready" &&
    input.event.kind !== "review.submitted" &&
    input.event.kind !== "thread.created"
  ) {
    return false
  }
  return !input.event.labels.includes(label)
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
