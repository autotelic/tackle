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
