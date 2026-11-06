import { mkdirSync } from "node:fs"
import { Predicate, Result, Schema } from "effect"
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
const textOf = (entry: { readonly model?: unknown; readonly data?: unknown }): string => {
  const parts: Array<string> = []
  const messages: ReadonlyArray<unknown> = Array.isArray(entry.model) ? entry.model : []
  for (const message of messages) {
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

/**
 * One entry as the view shows it.
 *
 * An entry written with no kind -- a surface bug from before the argument fix carried one -- must
 * not read as `undefined`: that looks like the viewer broke, which is the opposite of what an
 * anomaly should look like. It is named as unreadable, with the reason, and stays visible.
 *
 * @param entry - The stored entry, or the part of one a test needs.
 * @returns The entry as a surface renders it.
 */
export const sessionEntryOf = (entry: {
  readonly id: string | number
  readonly kind: string
  readonly model?: unknown
  readonly data?: unknown
}): SessionEntry => {
  const kind = String(entry.kind)
  if (kind !== "" && kind !== "undefined") {
    return { id: String(entry.id), kind, text: textOf(entry) }
  }
  return {
    id: String(entry.id),
    kind: "unreadable",
    text: "(no kind or payload; written by an older surface)",
  }
}

const viewOf = (value: ConversationView): ReadonlyArray<SessionEntry> =>
  value.entries.map(sessionEntryOf)

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
 * The kinds the surface writes about its own work: an edit ran, a session opened or closed.
 *
 * They are worth recording and useless in a conversation view: every `edit` buries the decision
 * someone needs to read. A view shows talk by default and telemetry on request.
 */
const TELEMETRY: ReadonlySet<string> = new Set(["room.edit", "room.session", "room.tool"])

/**
 * Whether an entry is the surface narrating itself rather than a person or the model talking.
 *
 * @param kind - The entry's kind.
 * @returns True for the surface's own telemetry.
 */
export const isTelemetry: Predicate.Predicate<string> = (kind) => TELEMETRY.has(kind)

/**
 * The last entries, for a surface that cannot stream.
 *
 * `--watch` serves a person watching; an agent asking "what happened while I was away" needs
 * one answer, oldest last, which is this. The window is a page of the transcript, not the model
 * context: compaction and resets stay visible. Telemetry is filtered out unless asked for, so a
 * busy room still reads as a conversation.
 *
 * @param input - The session, how many entries to read, and whether to include telemetry.
 * @returns The entries, oldest first.
 */
export const recentEntries = async (input: {
  readonly session: RoomSession
  readonly limit: number
  readonly includeTelemetry?: boolean | undefined
}): Promise<ReadonlyArray<SessionEntry>> => {
  // One page, widened when telemetry is filtered out: the window should hold `limit` entries of
  // the kind asked for, not whatever mixture happens to be newest.
  const wanted = Math.max(1, input.limit)
  const page = await input.session.root.entries(
    { order: "descending" },
    input.includeTelemetry === true ? wanted : wanted * 8,
    undefined,
    BACKGROUND_CONTEXT,
  )
  return page.items
    .map(sessionEntryOf)
    .filter((entry) => input.includeTelemetry === true || !isTelemetry(entry.kind))
    .slice(0, wanted)
    .reverse()
}

/** How many entries a follower re-reads when it looks for what another client committed. */
const FOLLOW_PAGE = 50

/** How often a follower looks, by default. */
const FOLLOW_POLL_MS = 1000

/**
 * Follow the conversation: the entries at attachment, then each commit that adds more.
 *
 * This is what makes the room multiplayer without a second registry: every surface attaches to
 * the same committed state, and the library decides who runs.
 *
 * @param input - The session, what to do with each batch of entries, and whether the entries
 *   already committed count as a batch.
 * @returns A function that stops the follow.
 */
export const followRoomSession = async (input: {
  readonly session: RoomSession
  readonly onEntries: (entries: ReadonlyArray<SessionEntry>) => void
  /**
   * Whether the conversation as it stands at attach is delivered as the first batch. Default
   * true: a person who opens a watch wants the page, not only the future.
   *
   * A surface that turns each batch into a message passes false. Its injected entries are
   * persisted, so a replay is not a catch-up there -- it is the same history appended to the
   * transcript again on every resume. Those surfaces read history on demand instead
   * (`recentEntries`, or the conversation view a badge and the tools already ask for).
   */
  readonly replay?: boolean | undefined
  /** How often to look for entries another client committed. Default 1000ms. */
  readonly pollMs?: number | undefined
}): Promise<() => Promise<void>> => {
  const watch = await input.session.root.watch(BACKGROUND_CONTEXT)
  const seen = new Set<string>()
  const deliver = (entries: ReadonlyArray<SessionEntry>): void => {
    const fresh = entries.filter((entry) => !seen.has(entry.id))
    for (const entry of fresh) seen.add(entry.id)
    if (fresh.length > 0) input.onEntries(fresh)
  }
  const emit = (value: ConversationView): void => deliver(viewOf(value))
  if (input.replay === false) {
    // Seed the ids and deliver nothing: the head is where this client joined, so everything
    // before it is history it can ask for rather than history it is handed.
    for (const entry of viewOf(watch.value)) seen.add(entry.id)
  } else {
    emit(watch.value)
  }
  watch.start(async (call) => {
    if (call.kind !== "value") return
    emit(call.value)
  })
  // The library's watch publishes the commits of *this* storage client, and the storage has no
  // change feed across processes. A room has many clients -- a Pi surface, the daemon, another
  // person's terminal -- so a follower that only listened would deliver its own writes and
  // nothing else, which is not multiplayer. Re-reading a page is the cheapest honest way to see
  // the rest; ids dedupe against the watch, so a client's own commits still arrive at once.
  const poll = setInterval(() => {
    void recentEntries({ session: input.session, limit: FOLLOW_PAGE, includeTelemetry: true })
      .then(deliver)
      .catch(() => undefined)
  }, input.pollMs ?? FOLLOW_POLL_MS)
  poll.unref?.()
  return async () => {
    clearInterval(poll)
    await watch.stop()
  }
}

/** Close the harness and its storage. */
export const closeRoomSession = async (session: RoomSession): Promise<void> => {
  await session.harness.close(BACKGROUND_CONTEXT)
}
