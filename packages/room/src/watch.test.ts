import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { RoomSession, SessionEntry } from "./session.ts"
import { closeRoomSession, followRoomSession, noteToRoom, openRoomSession } from "./session.ts"

/*
 * Where a watch starts, and how it sees another client.
 *
 * A surface that turns each batch into a message -- the Pi extension's `room.session` entries --
 * persists what it is handed. Delivering the conversation at attach therefore appended a room's
 * whole history to that session again on every resume: a Nov 3 conversation about another
 * project's pull requests landed in a Nov 4 transcript, and would have landed again on the next
 * resume. These fixtures pin the head, pin the page a person watching still gets, and pin the
 * other half: a room has several clients, and the library's watch only publishes the commits of
 * the client that made them.
 */

const sessions: Array<RoomSession> = []
const dirs = new Set<string>()

/** A storage directory for this test, removed afterwards. */
const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "room-watch-"))
  dirs.add(dir)
  return dir
}

/** Open a conversation over `dir`'s storage: a second call is a second client, as a terminal is. */
const open = async (dir: string): Promise<RoomSession> => {
  const session = await openRoomSession({ storagePath: join(dir, "session.sqlite") })
  sessions.push(session)
  return session
}

afterEach(async () => {
  for (const session of sessions.splice(0).reverse()) await closeRoomSession(session)
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.clear()
})

/** The batches a follow delivered, flattened: each entry once, in the order it arrived. */
const collected = () => {
  const batches: Array<ReadonlyArray<SessionEntry>> = []
  return {
    batches,
    entries: (): ReadonlyArray<SessionEntry> => batches.flat(),
    onEntries: (entries: ReadonlyArray<SessionEntry>): void => {
      batches.push(entries)
    },
  }
}

/** Wait for a condition the follow delivers asynchronously, or fail with what did arrive. */
const until = async (predicate: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("following the room's conversation", () => {
  it("delivers the conversation at attach, so a person watching sees the page", async () => {
    const session = await open(freshDir())
    await noteToRoom({ session, kind: "room.decision", data: { raw: '{"probe":"earlier"}' } })
    const seen = collected()
    const stop = await followRoomSession({ session, onEntries: seen.onEntries })
    await stop()
    expect(seen.entries()).toEqual([
      { id: expect.any(String), kind: "room.decision", text: '{"probe":"earlier"}' },
    ])
  })

  it("starts at the head with replay false, and then delivers what happens next", async () => {
    const session = await open(freshDir())
    // Written before this client joined: history, not news.
    await noteToRoom({ session, kind: "room.decision", data: { raw: '{"probe":"earlier"}' } })
    const seen = collected()
    const stop = await followRoomSession({
      session,
      replay: false,
      onEntries: seen.onEntries,
    })
    expect(seen.batches).toEqual([])

    await noteToRoom({ session, kind: "room.reply", data: { raw: '{"probe":"after"}' } })
    await until(() => seen.batches.length > 0, "the entry written after the attach")

    // Exactly one entry, and it is the new one: the seeded head was never delivered, even though
    // the batch that carried the new entry also carried it.
    expect(seen.entries()).toEqual([
      { id: expect.any(String), kind: "room.reply", text: '{"probe":"after"}' },
    ])
    await stop()
  })

  it("delivers an entry another client committed, which the library's own watch cannot see", async () => {
    const dir = freshDir()
    const follower = await open(dir)
    const other = await open(dir)
    const seen = collected()
    const stop = await followRoomSession({
      session: follower,
      replay: false,
      pollMs: 20,
      onEntries: seen.onEntries,
    })
    expect(seen.batches).toEqual([])

    // A second client over the same committed state: another person's Pi, the daemon, or a
    // `room session --note` in a terminal. Its commit never reaches the in-process watch.
    await noteToRoom({
      session: other,
      kind: "room.reply",
      data: { raw: '{"text":"from-elsewhere"}' },
    })
    await until(() => seen.entries().length > 0, "an entry committed by another client")

    expect(seen.entries()).toEqual([
      { id: expect.any(String), kind: "room.reply", text: '{"text":"from-elsewhere"}' },
    ])
    await stop()
  })

  it("delivers each entry once, however many commits repeat it", async () => {
    const session = await open(freshDir())
    const seen = collected()
    const stop = await followRoomSession({
      session,
      replay: false,
      onEntries: seen.onEntries,
    })
    await noteToRoom({ session, kind: "room.decision", data: { raw: "one" } })
    await until(() => seen.entries().length === 1, "the first entry")
    await noteToRoom({ session, kind: "room.decision", data: { raw: "two" } })
    await until(() => seen.entries().length === 2, "the second entry")
    const ids = seen.entries().map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    await stop()
  })
})
