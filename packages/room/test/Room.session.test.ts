import { defineTask } from "@earendil-works/pi-durable"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { roomSessionState } from "../src/RoomSession.ts"
import {
  createRoom,
  openRoomJournal,
  pauseRoom,
  readRoom,
  resumeRoom,
  roomDir,
} from "../src/store.ts"

/*
 * A room's journal is its position, and a position is only durable if it survives the lifecycle
 * that runs around it. These tests open the real pi-durable session over a real sqlite file —
 * no in-memory storage — because that is the claim: the bytes are on disk, and reopening them
 * finds the conversation, the task and the request id that were committed before the close.
 */

const scratch = async (id: string) => {
  const root = await mkdtemp(join(tmpdir(), "room-session-"))
  const created = await createRoom({
    root,
    id,
    repo: root,
    scope: id,
    base: "main",
    at: 1_700_000_000_000,
  })
  if (!created.ok) throw new Error("createRoom refused: " + created.error)
  return { root, id, dir: roomDir({ root, id }), room: created.value }
}

/** A task the room journals but nothing schedules: the Session is opened without a Harness. */
const noteTask = defineTask<
  { readonly label: string },
  { readonly phase: "waiting"; readonly label: string },
  string,
  object
>({
  name: "room.session.note",
  version: 1,
  initial: (input) => ({ phase: "waiting", label: input.label }),
  phases: { waiting: async () => {} },
  abort: async () => {},
})

test("creating a room names its journal and initializes the storage", async () => {
  const { root, dir, room } = await scratch("dev")
  try {
    expect(room.session).toEqual({ path: "session.sqlite", openedAt: 1_700_000_000_000 })
    expect(existsSync(join(dir, "session.sqlite"))).toBe(true)
    expect(roomSessionState({ dir, session: room.session })).toBe("durable")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a conversation, a task and a request id survive close and reopen", async () => {
  const { root, id } = await scratch("dev")
  try {
    const first = await openRoomJournal({ root, id })
    const conversation = await first.session.commit((tx) =>
      tx.createConversation({ ownership: { kind: "ownerless" } }),
    )
    const taskId = await first.session.commit((tx) =>
      tx.createTask(
        noteTask,
        { label: "keep me" },
        { ownership: { kind: "conversation" }, conversationId: conversation.id },
      ),
    )
    const admitted = await first.write({
      conversationId: conversation.id,
      requestId: "run-1",
      entry: { kind: "room.note", data: { text: "first" } },
    })
    expect(admitted.status).toBe("admitted")
    // The same request id in the same session appends nothing and answers with the first entry.
    const repeated = await first.write({
      conversationId: conversation.id,
      requestId: "run-1",
      entry: { kind: "room.note", data: { text: "second" } },
    })
    expect(repeated.status).toBe("existing")
    expect(repeated.submission.id).toBe(admitted.submission.id)
    expect(repeated.entryId).toBe(admitted.entryId)
    await first.close()

    const reopened = await openRoomJournal({ root, id })
    const stored = await reopened.session.commit((tx) => tx.conversation(conversation.id))
    expect(stored?.id).toBe(conversation.id)
    const task = await reopened.session.commit((tx) => tx.task(taskId))
    expect(task?.input).toEqual({ label: "keep me" })
    expect(task?.kind).toBe("room.session.note")
    // Idempotency is a fact about the storage, not about the handle that wrote it: a fresh
    // session finds the request id and writes nothing.
    const again = await reopened.write({
      conversationId: conversation.id,
      requestId: "run-1",
      entry: { kind: "room.note", data: { text: "third" } },
    })
    expect(again.status).toBe("existing")
    expect(again.submission.id).toBe(admitted.submission.id)
    expect(again.entryId).toBe(admitted.entryId)
    await reopened.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("pause and resume leave the journal and its requests intact", async () => {
  const { root, id } = await scratch("dev")
  try {
    const first = await openRoomJournal({ root, id })
    const conversation = await first.session.commit((tx) =>
      tx.createConversation({ ownership: { kind: "ownerless" } }),
    )
    const admitted = await first.write({
      conversationId: conversation.id,
      requestId: "checkpoint-1",
      entry: { kind: "room.note", data: { text: "before the pause" } },
    })
    await first.close()

    const paused = await pauseRoom({ root, id, at: 2 })
    expect(paused.ok).toBe(true)
    const resumed = await resumeRoom({ root, id, at: 3 })
    expect(resumed.ok).toBe(true)

    const reopened = await openRoomJournal({ root, id })
    const again = await reopened.write({
      conversationId: conversation.id,
      requestId: "checkpoint-1",
      entry: { kind: "room.note", data: { text: "after the resume" } },
    })
    expect(again.status).toBe("existing")
    expect(again.submission.id).toBe(admitted.submission.id)
    await reopened.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a room file written before the session field still decodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-session-legacy-"))
  try {
    const dir = roomDir({ root, id: "old" })
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, "room.json"),
      JSON.stringify({
        id: "old",
        base: "main",
        state: { _tag: "Ready", repo: root, scope: "old", createdAt: 1 },
      }) + "\n",
    )
    const room = await readRoom({ root, id: "old" })
    expect(room?.state._tag).toBe("Ready")
    expect(room?.session).toBeUndefined()
    // Without a record the journal still has a default name; it just is not there yet.
    expect(roomSessionState({ dir, session: room?.session })).toBe("absent")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
