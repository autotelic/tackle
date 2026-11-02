import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { createRegistry, Harness, LiveDoc } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import type { LiveState } from "@earendil-works/pi-durable"

/*
 * The room's session is a durable conversation, not a process we keep alive.
 *
 * `@earendil-works/pi-durable` commits every entry, run, and tool call to storage before it is
 * shown, resumes the work when the process that died reopens it, and admits input by its own
 * busy/idle rules. The room used to invent that: a heartbeated session id, a staleness window,
 * and a `pi -p --session` spawn to wake what had gone quiet. That was a re-implementation with
 * a worse failure mode (two writers, or none), and the brief for the room named pi-durable.
 *
 * This module is the seam: open, submit, and read a view. Nothing here owns a terminal.
 */

/** One opened room conversation. */
export interface RoomSession {
  readonly id: string
  readonly harness: Harness
  readonly root: Awaited<ReturnType<Harness["root"]>>
}

/**
 * Open the room's conversation over its own storage.
 *
 * @param input - Where the storage lives and which model answers.
 * @returns The harness and the root conversation, created on first use.
 */
export const openRoomSession = async (input: {
  readonly storagePath: string
  readonly model?: { readonly provider: string; readonly modelId: string } | undefined
}): Promise<RoomSession> => {
  mkdirSync(dirname(input.storagePath), { recursive: true })
  const storage = await openNodeSqliteStorage(input.storagePath)
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  const root = await harness.root(
    BACKGROUND_CONTEXT,
    input.model === undefined ? {} : { agent: { model: input.model } },
  )
  return { id: String(root.id), harness, root }
}

/**
 * Hand one delivered item to the conversation.
 *
 * `followUp` is the default: an item that arrives mid-run is queued and answered after, which is
 * the semantics the room was hand-rolling with a 30-second hold. A failure to admit (a closed
 * harness) is reported, not thrown, so the daemon's loop keeps going.
 *
 * @param input - The session and the text a person or a webhook handed it.
 * @returns The submission id, or why the conversation did not take it.
 */
export const submitToRoom = async (input: {
  readonly session: RoomSession
  readonly text: string
}): Promise<string> => {
  const submission = await input.session.root.submit(
    { type: "input", content: input.text },
    BACKGROUND_CONTEXT,
  )
  return String(submission.id)
}

/** What a view of the room's conversation says, in the shape a badge and a board read. */
export interface SessionView {
  readonly id: string
  /** True while a run is working: input queues, it does not race. */
  readonly busy: boolean
  /** Why the last run ended without an answer, when it did. */
  readonly runFailure?: string | undefined
  /** Inputs admitted and not yet placed. */
  readonly queued: number
}

/**
 * Read the conversation's live state.
 *
 * @param session - The opened conversation.
 * @returns The id, whether a run is working, why the last one failed, and the queue depth.
 */
export const roomSessionView = async (session: RoomSession): Promise<SessionView> => {
  const live = await session.harness.snapshot(LiveDoc, session.root.id, BACKGROUND_CONTEXT)
  const state: LiveState | undefined = live
  const busy = state?.run !== undefined && state.run !== null
  const failure = state?.runFailure
  if (failure === undefined) return { id: session.id, busy, queued: 0 }
  return { id: session.id, busy, queued: 0, runFailure: failure.reason }
}

/** Close the harness and its storage. */
export const closeRoomSession = async (session: RoomSession): Promise<void> => {
  await session.harness.close(BACKGROUND_CONTEXT)
}
