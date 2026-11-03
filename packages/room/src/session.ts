import { mkdirSync } from "node:fs"
import { Result, Schema } from "effect"
import { dirname } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { createRegistry, Harness, LiveDoc } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import type { Conversation, JsonObject, LiveState } from "@earendil-works/pi-durable"
import type { ConversationView } from "@earendil-works/pi-durable"
import type { RoomConfig } from "./config.ts"
import { sessionPath } from "./paths.ts"

/*
 * The room's session is a durable conversation, not a process we keep alive.
 *
 * `@earendil-works/pi-durable` commits every entry, run, and tool call to storage before it is
 * shown, resumes the work when the process that died reopens it, and admits input by its own
 * busy/idle rules. The room used to invent that: a heartbeated session id, a staleness window,
 * and a `pi -p --session` spawn to wake what had gone quiet. That was a re-implementation with
 * a worse failure mode (two writers, or none), and the brief for the room named pi-durable.
 *
 * Multiplayer falls out of the same facts: one conversation in one storage, many clients. A
 * person's Pi session watches it and submits into it; the daemon watches it and submits
 * webhook deliveries; neither owns a terminal, and the library decides who runs.
 */

/** One opened room conversation. */
export interface RoomSession {
  readonly id: string
  readonly harness: Harness
  readonly root: Conversation
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
  // Scheduling is explicit: without it nothing runs a task.
  harness.resume()
  const root = await harness.root(
    BACKGROUND_CONTEXT,
    input.model === undefined ? {} : { agent: { model: input.model } },
  )
  return { id: String(root.id), harness, root }
}

/**
 * Open the conversation a room's config points at.
 *
 * @param config - The room's committed config, which names the model that answers.
 * @returns The opened conversation.
 */
export const openSessionFor = (config: RoomConfig): Promise<RoomSession> =>
  openRoomSession({
    storagePath: sessionPath(config),
    model: { provider: config.review.provider, modelId: config.review.model },
  })

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

/** One entry as a surface renders it: what was said, not the storage shape. */
export interface SessionEntry {
  readonly id: string
  readonly kind: string
  readonly text: string
}

/** A model message whose content is one string, and one whose content is a list of parts. */
const TextMessage = Schema.Struct({ content: Schema.String })
const Part = Schema.Struct({ text: Schema.optionalKey(Schema.String) })
const PartsMessage = Schema.Struct({ content: Schema.Array(Part) })
const decodeText = Schema.decodeUnknownResult(TextMessage)
const decodeParts = Schema.decodeUnknownResult(PartsMessage)
const decodeString = Schema.decodeUnknownResult(Schema.String)
const decodeEnvelope = Schema.decodeUnknownResult(Schema.Struct({ raw: Schema.String }))

/**
 * The text a transcript entry carries.
 *
 * Decoded, not asserted: pi-durable's model messages are either one string or a list of parts,
 * and an entry may carry none. A shape this does not recognize contributes nothing, so a
 * library change degrades to an empty line instead of a wrong one.
 */
const textOf = (entry: ConversationView["entries"][number]): string => {
  const parts: Array<string> = []
  for (const message of entry.model ?? []) {
    const text = Result.getOrUndefined(decodeText(message))
    if (text !== undefined) {
      parts.push(text.content)
      continue
    }
    const content = Result.getOrUndefined(decodeParts(message))
    if (content === undefined) continue
    for (const part of content.content) {
      if (part.text !== undefined) parts.push(part.text)
    }
  }
  const text = parts.join("\n").trim()
  if (text !== "") return text
  // A write carries no model messages: its payload *is* the entry. Without this the view
  // showed kinds and nothing else, so a recorded note was invisible.
  if (entry.data === undefined) return ""
  const envelope = Result.getOrUndefined(decodeEnvelope(entry.data))
  if (envelope !== undefined) return envelope.raw
  const quoted = Result.getOrUndefined(decodeString(entry.data))
  return quoted ?? JSON.stringify(entry.data)
}

const viewOf = (value: ConversationView): ReadonlyArray<SessionEntry> =>
  value.entries.map((entry) => ({
    id: String(entry.id),
    kind: String(entry.kind),
    text: textOf(entry),
  }))

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

/**
 * Hand one delivered item to the conversation.
 *
 * `followUp` is the default: an item that arrives mid-run is queued and answered after, which is
 * the semantics the room was hand-rolling with a 30-second hold.
 *
 * @param input - The session and the text a person or a webhook handed it.
 * @returns The submission id.
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

/**
 * Record a fact in the conversation without asking the model anything.
 *
 * pi-durable distinguishes an *input* (the model answers) from a *write* (an entry the model
 * does not see). Broadcast is the second: a tool ran, a file changed, a session opened — facts a
 * person or an agent decided are worth recording, pushed by a hook rather than chosen by the
 * agent, and never a prompt. The brief asked for exactly this, because an agent that must
 * choose to broadcast will not.
 *
 * @param input - The session, the entry kind, and the JSON payload.
 * @returns The submission id.
 */
export const noteToRoom = async (input: {
  readonly session: RoomSession
  readonly kind: string
  readonly data: JsonObject
}): Promise<string> => {
  const submission = await input.session.root.submit(
    { type: "write", entry: { kind: input.kind, data: input.data } },
    BACKGROUND_CONTEXT,
  )
  return String(submission.id)
}

/**
 * The last entries, for a surface that cannot stream.
 *
 * `--watch` serves a person watching; an agent asking "what happened while I was away" needs
 * one answer, oldest last, which is this. The window is a page of the transcript, not the model
 * context: compaction and resets stay visible.
 *
 * @param input - The session and how many entries to read.
 * @returns The entries, oldest first.
 */
export const recentEntries = async (input: {
  readonly session: RoomSession
  readonly limit: number
}): Promise<ReadonlyArray<SessionEntry>> => {
  const page = await input.session.root.entries(
    { order: "descending" },
    Math.max(1, input.limit),
    undefined,
    BACKGROUND_CONTEXT,
  )
  return page.items
    .map((entry) => ({ id: String(entry.id), kind: String(entry.kind), text: textOf(entry) }))
    .reverse()
}

/**
 * Follow the conversation: the entries at attachment, then each commit that adds more.
 *
 * This is what makes the room multiplayer without a second registry: every surface attaches to
 * the same committed state, and the library decides who runs.
 *
 * @param input - The session, and what to do with each batch of entries.
 * @returns A function that stops the follow.
 */
export const followRoomSession = async (input: {
  readonly session: RoomSession
  readonly onEntries: (entries: ReadonlyArray<SessionEntry>) => void
  /** Start from here instead of the window's first value. */
  readonly from?: string | undefined
}): Promise<() => Promise<void>> => {
  const watch = await input.session.root.watch(BACKGROUND_CONTEXT)
  const seen = new Set<string>()
  const emit = (value: ConversationView): void => {
    const fresh = viewOf(value).filter((entry) => !seen.has(entry.id))
    for (const entry of fresh) seen.add(entry.id)
    if (fresh.length > 0) input.onEntries(fresh)
  }
  emit(watch.value)
  watch.start(async (call) => {
    if (call.kind !== "value") return
    emit(call.value)
  })
  return async () => {
    await watch.stop()
  }
}

/** Close the harness and its storage. */
export const closeRoomSession = async (session: RoomSession): Promise<void> => {
  await session.harness.close(BACKGROUND_CONTEXT)
}
