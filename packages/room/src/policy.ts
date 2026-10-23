import { Predicate } from "effect"
import { actorOf, jobOf, type Job, type RoomId } from "@autotelic/board"
import type { RoomEvent } from "./ingest.ts"

/*
 * The review policy, in one function.
 *
 * A review request is an address. Ed clicking "re-request review" names a person, and only
 * that person's rooms act. That single rule replaces a watch-every-PR filter and makes two
 * independent local rooms impossible to confuse.
 *
 * `synchronize` is deliberately absent: a push is not a request for another review. The
 * person decides when the next pass happens.
 */

/** Whether this event asks this room for a review. */
export const shouldReview: Predicate.Predicate<{
  readonly event: RoomEvent
  readonly actor: string
}> = ({ event, actor }: { readonly event: RoomEvent; readonly actor: string }) =>
  event.kind === "review.requested" &&
  !event.draft &&
  event.reviewer !== "" &&
  actorOf(event.reviewer) === actor

/** The job a review request creates. */
export const reviewJob = ({
  event,
  room,
  now,
}: {
  readonly event: Extract<RoomEvent, { kind: "review.requested" }>
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
