import { actorOf } from "@autotelic/board"
import { Result } from "effect"
import { RoomClient } from "./client.ts"
import type { RoomConfig } from "./config.ts"

/*
 * The committed half and the running half.
 *
 * `room.config.json` is what a second machine inherits; the ledger is what the room is actually
 * doing. Nothing copied one into the other, so an attached room accepted every webhook, queued
 * no job, delivered no inbox item, and read clean -- the actor, the watched label, and the batch
 * hold lived only in the file (run 4's one missing wire). This module is that copy, and it lives
 * beside the client rather than in the commands so both the CLI and the daemon can use it
 * without a cycle.
 */

/** What `PUT /config` takes, as the file supplies it. */
interface SeedBody {
  actor: string
  name: string
  label?: string
  linearUser?: string
  batchMs?: number
}

/**
 * Put the committed config's decisions into the room's running ledger.
 *
 * Idempotent, so every startup runs it. The actor is seeded normalized (`github:<login>`),
 * which is the form the review policy compares against.
 *
 * @param input - The room's config and the URL it is listening on.
 * @returns What was seeded, or why the room did not take it.
 */
export const seedRoom = async (input: {
  readonly config: RoomConfig
  readonly url: string
}): Promise<Result.Result<string, string>> => {
  const login = input.config.stage.split("/").at(-1) ?? ""
  const label = input.config.watch?.label
  const body: SeedBody = { actor: actorOf(login), name: input.config.name }
  if (label !== undefined) body.label = label
  if (input.config.linearUser !== undefined) body.linearUser = input.config.linearUser
  if (input.config.batchMs !== undefined) body.batchMs = input.config.batchMs
  // SAFETY: configure() is the room's HTTP boundary and rejects on a transport failure; a
  // room that is down is a note here, not a reason to abort the daemon's loop.
  try {
    await new RoomClient(input.url, input.config.room).configure(body)
  } catch {
    return Result.fail(`room not reachable at ${input.url}`)
  }
  const parts = [`actor ${body.actor}`]
  if (label !== undefined) parts.push(`label ${label}`)
  if (input.config.batchMs !== undefined) parts.push(`batch ${String(input.config.batchMs)}ms`)
  return Result.succeed(parts.join(" · "))
}
