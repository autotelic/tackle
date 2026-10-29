import { actorOf } from "@autotelic/board"
import { Result } from "effect"
import type { RoomEvent } from "./ingest.ts"

/*
 * What the project session hears.
 *
 * An event is a message only when it is addressed to the person whose session this is. Ed's
 * comment on a PR is a turn; a labeled PR that a worker will review is a card; a state change
 * is a card. Everything else is a receipt in the ledger and stays quiet.
 *
 * The message carries provenance (who, where, which PR) and the body, not the webhook. The
 * session should not have to know GitHub's JSON to answer a person.
 */

/** One draft message for the project session. */
export interface InboxDraft {
  readonly id: string
  readonly kind: "turn" | "card"
  readonly pr?: number
  readonly ticket?: string
  readonly text: string
}

const clip = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length <= 2_000 ? trimmed : `${trimmed.slice(0, 2_000)}…`
}

const where = (path: string, line: number): string =>
  path === "" ? "" : line === 0 ? ` at ${path}` : ` at ${path}:${line}`

/**
 * Turn one event into the message the project session should receive, or nothing.
 *
 * @param input - The event and the room's actor.
 * @returns A draft addressed to this session, or undefined when it stays quiet.
 */
export const inboxFor = ({
  event,
  actor,
  linearUser,
}: {
  readonly event: RoomEvent
  readonly actor: string
  readonly linearUser?: string
}): Result.Result<InboxDraft, string> => {
  if (event.kind === "comment.created") {
    if (linearUser !== undefined && event.author === linearUser) {
      return Result.fail("the actor's own Linear comment")
    }
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: "turn",
      ticket: event.ticket,
      text: `${event.author} commented on ${event.ticket}:\n\n${clip(event.body)}`,
    })
  }
  if (event.kind === "thread.created") {
    if (actorOf(event.author) === actor) return Result.fail("not addressed to this session")
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: "turn",
      pr: event.pr,
      text: `${event.author} commented on #${event.pr}${where(event.path, event.line)}:\n\n${clip(event.body)}`,
    })
  }
  if (event.kind === "review.submitted") {
    if (actorOf(event.reviewer) === actor) return Result.fail("not addressed to this session")
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: event.body.trim() === "" ? "card" : "turn",
      pr: event.pr,
      text: `${event.reviewer} reviewed #${event.pr} (${event.state}):\n\n${clip(event.body)}`,
    })
  }
  if (event.kind === "pr.ready") {
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: "card",
      pr: event.pr,
      text: `#${event.pr} is ready for review (${event.labels.join(", ") || "no labels"}).`,
    })
  }
  if (event.kind === "pr.closed") {
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: "card",
      pr: event.pr,
      text: `#${event.pr} was ${event.merged ? "merged" : "closed"}.`,
    })
  }
  if (event.kind === "issue.changed") {
    return Result.succeed({
      id: `inbox:${event.id}`,
      kind: "card",
      ticket: event.identifier,
      text: `${event.identifier} moved to ${event.state}.`,
    })
  }
  return Result.fail("not addressed to this session")
}
