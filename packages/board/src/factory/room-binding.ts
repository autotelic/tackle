import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { roomSessionEnv, roomSessionEnvironment } from "@autotelic/room/RoomSession"
import { readRoom, roomWorktree } from "@autotelic/room/store"
import { canonicalPath, type RoomBinding } from "./store.ts"

/*
 * A workstream's room, resolved.
 *
 * The record keeps one worktree — `path`, adopted once and never rewritten
 * (`docs/workstream.md` rule 2) — and the binding is a reference to the room that work happens
 * in. Resolving it here is the only place that maps a room id and root onto a directory, and it
 * refuses a room that names anything but the adopted checkout: a pass that ran in the room's
 * directory anyway would be two sources of truth for one worktree, and a pass that quietly kept
 * `record.path` would make the binding decorative. The refusal names both, so the operator fixes
 * the record instead of guessing which one won.
 */

/** What a bound pass needs: where the worker runs, and the journal it must open. */
export interface ResolvedRoom {
  readonly worktree: string
  readonly environment: Readonly<Record<string, string>>
}

/** No binding is a workstream without a room; anything else is a resolution or a refusal. */
export type RoomResolution =
  | { readonly ok: true; readonly value: ResolvedRoom }
  | { readonly ok: false; readonly reason: string }

/**
 * Resolve a workstream's room binding against the checkout it was adopted on.
 *
 * @param input - the binding (absent for an unbound workstream) and the adopted worktree.
 * @returns undefined when unbound, the room's worktree and environment when it agrees, or the
 *   refusal naming what is missing or what disagreed.
 */
export const resolveRoom = async (input: {
  readonly room: RoomBinding | undefined
  readonly path: string
}): Promise<RoomResolution | undefined> => {
  const binding = input.room
  if (binding === undefined) return undefined
  const root = resolve(binding.root)
  const worktree = roomWorktree({ root, id: binding.id })
  // SAFETY: a room file that does not decode is a refusal to report, not a crash in the pass.
  const read = await readRoom({ root, id: binding.id }).then(
    (room) => ({ ok: true as const, room }),
    (cause: unknown) => ({ ok: false as const, detail: String(cause) }),
  )
  if (!read.ok)
    return { ok: false, reason: "RoomUnreadable: room " + binding.id + ": " + read.detail }
  const room = read.room
  if (room === undefined)
    return { ok: false, reason: "RoomMissing: no room " + binding.id + " under " + root }
  if (!existsSync(worktree))
    return {
      ok: false,
      reason: "RoomWorktreeMissing: room " + binding.id + " has no worktree at " + worktree,
    }
  const adopted = canonicalPath(input.path)
  const named = canonicalPath(worktree)
  if (named !== adopted)
    return {
      ok: false,
      reason:
        "RoomMismatch: room " +
        binding.id +
        " has worktree " +
        worktree +
        ", but this workstream was adopted at " +
        input.path,
    }
  // The room module writes the three variables and resolves the journal path from the room's
  // own record, so the worker opens the same file the control plane checkpoints on pause.
  return {
    ok: true,
    value: {
      worktree,
      environment: roomSessionEnv(
        roomSessionEnvironment({ root, id: binding.id, session: room.session }),
      ),
    },
  }
}
