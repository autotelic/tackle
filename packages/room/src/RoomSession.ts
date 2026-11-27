import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createSession } from "@earendil-works/pi-durable"
import type {
  ConversationId,
  EntryDraft,
  EntryId,
  Session,
  SubmissionRecord,
  Tx,
} from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import * as Schema from "effect/Schema"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

/*
 * A room's durable journal.
 *
 * pi-durable is the engine and the room owns only where the bytes live (docs/shop.md §7.1):
 * `session.sqlite` under the room's own directory is the whole position a bench resumes from —
 * conversation, tasks, pending submissions, sleeps — which is why pause and move can copy a
 * quiesced file instead of a live one (docs/shop.md §5).
 *
 * The room opens pi-durable's Session kernel, not its Harness. A Harness is `Harness.open(storage,
 * { models, registry })`: it needs a model catalog and a tool registry, and those belong to the
 * agent process that runs the bench, not to the control plane that creates, pauses and resumes the
 * room. Both agree on the file, so the journal a pause closes is the journal that agent reopens.
 */

/** What the room file records about its journal: where, and when it was first opened. */
export const RoomSessionRecord = Schema.Struct({
  /**
   * The journal file, relative to the room's own directory.
   *
   * A name rather than an absolute path, so a room that is moved or restored under another root
   * keeps its own journal instead of naming one on the machine it came from.
   */
  path: Schema.String,
  /** Epoch milliseconds of the lifecycle command that first opened it. */
  openedAt: Schema.Int,
})
export type RoomSessionRecord = typeof RoomSessionRecord.Type

/** The name a room gives its journal when its record names none. */
export const roomSessionFile = "session.sqlite"

/** The record a newly created room writes. */
export const defaultRoomSession = (at: number): RoomSessionRecord => ({
  path: roomSessionFile,
  openedAt: at,
})

/**
 * The journal's absolute path for one room directory.
 *
 * A room file written before this field existed names none, and takes the default name: the
 * absence of a record is not the absence of a journal.
 */
export const roomSessionPath = (input: {
  readonly dir: string
  readonly session?: RoomSessionRecord | undefined
}): string => resolve(input.dir, input.session?.path ?? roomSessionFile)

/**
 * Whether the journal's bytes are on disk, read now.
 *
 * Observed, never declared: the room file can say it named a journal for a disk that was since
 * cleared, and a reader asking "is this position still there" wants the fact rather than the
 * record's optimism.
 */
export const roomSessionState = (input: {
  readonly dir: string
  readonly session?: RoomSessionRecord | undefined
}): "durable" | "absent" => (existsSync(roomSessionPath(input)) ? "durable" : "absent")

export class RoomSessionError extends Error {
  readonly _tag = "RoomSessionError"
}

/** One idempotent write: a request id, and the entry it appends at most once. */
export interface SessionWrite {
  readonly conversationId: ConversationId
  readonly requestId: string
  readonly entry: EntryDraft
}

/** What a write did: appended an entry, or found the one its request id already appended. */
export interface SessionWriteOutcome {
  readonly status: "admitted" | "existing"
  readonly submission: SubmissionRecord
  readonly entryId: EntryId
}

/** The narrow handle one room holds on its journal. */
export interface RoomSession {
  /** The journal file, absolute. */
  readonly path: string
  /** pi-durable's own Session kernel; the room neither wraps nor re-implements it. */
  readonly session: Session
  /**
   * Admit one entry write under a request id, idempotently.
   *
   * The lookup and the write are one commit, the same order pi-durable's own admission uses:
   * a request id names one submission per conversation, so a host that resends after a restart
   * gets the entry it already has instead of a second copy of it.
   */
  write(input: SessionWrite): Promise<SessionWriteOutcome>
  /**
   * Close and checkpoint: admitted commits settle, then storage closes. Idempotent, because a
   * lifecycle command that failed after closing must not close twice.
   */
  close(): Promise<void>
}

/** Open one room's journal, creating it when it is not there yet. */
export const openRoomSession = async (input: {
  readonly dir: string
  readonly session?: RoomSessionRecord | undefined
}): Promise<RoomSession> => openRoomSessionAt(roomSessionPath(input))

/**
 * Open a journal by its exact path.
 *
 * The path form is what a process started by a room uses: the room hands its child an absolute
 * journal path in the environment, and the child must open that file rather than re-derive a
 * directory the room may since have moved.
 */
export const openRoomSessionAt = async (path: string): Promise<RoomSession> => {
  const journalPath = resolve(path)
  await mkdir(dirname(journalPath), { recursive: true })
  const storage = await openNodeSqliteStorage(journalPath)
  const session = createSession(storage)
  let closed = false
  return {
    path: journalPath,
    session,
    write: (write) =>
      session.commit(async (tx: Tx) => {
        const existing = await tx.submissionByRequest(write.conversationId, write.requestId)
        if (existing !== undefined) {
          // Only a settled passive write carries its entry, so anything else is another host
          // reusing this id for a different kind of submission, which is a mistake to surface
          // rather than a record to reuse.
          if (existing.type !== "write" || existing.status !== "done")
            throw new RoomSessionError(
              "request " +
                write.requestId +
                " already identifies a " +
                existing.type +
                " submission that is " +
                existing.status,
            )
          return { status: "existing", submission: existing, entryId: existing.entry } as const
        }
        const entry = await tx.appendEntry(write.conversationId, write.entry)
        const submission = await tx.createSubmission({
          conversationId: write.conversationId,
          requestId: write.requestId,
          type: "write",
          status: "done",
          entry: entry.id,
        })
        return { status: "admitted", submission, entryId: entry.id } as const
      }, BACKGROUND_CONTEXT),
    close: async () => {
      if (closed) return
      closed = true
      await session.close(BACKGROUND_CONTEXT)
    },
  }
}

/** The environment contract a room hands the process it started. */
export interface RoomSessionEnvironment {
  /** The room's root, absolute. */
  readonly root: string
  /** The room id. */
  readonly id: string
  /** The room's journal file, absolute. */
  readonly path: string
}

/** The names a room uses for that contract; one spelling for every worker. */
export const roomSessionEnvKeys = {
  root: "TACKLE_ROOM_ROOT",
  id: "TACKLE_ROOM_ID",
  path: "TACKLE_ROOM_SESSION",
} as const

/**
 * Resolve the contract for one room.
 *
 * A worker gets the absolute journal path rather than a directory to re-derive: the room file
 * names the journal (and an old file names the default), so both ends open the same bytes.
 */
export const roomSessionEnvironment = (input: {
  readonly root: string
  readonly id: string
  readonly session?: RoomSessionRecord | undefined
}): RoomSessionEnvironment => {
  const root = resolve(input.root)
  return {
    root,
    id: input.id,
    path: roomSessionPath({ dir: resolve(root, input.id), session: input.session }),
  }
}

/** Turn the contract into the environment entries a spawn passes to its child. */
export const roomSessionEnv = (
  environment: RoomSessionEnvironment,
): Readonly<Record<string, string>> => ({
  [roomSessionEnvKeys.root]: environment.root,
  [roomSessionEnvKeys.id]: environment.id,
  [roomSessionEnvKeys.path]: environment.path,
})

export class RoomSessionEnvironmentError extends Error {
  readonly _tag = "RoomSessionEnvironmentError"
}

/**
 * Read the contract from a process environment.
 *
 * All three fields are required: a child that knows a journal path but not which room owns it
 * cannot name an entry, and a room id without a path would silently derive a second journal.
 */
export const roomSessionEnvironmentFrom = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): RoomSessionEnvironment => {
  const root = env[roomSessionEnvKeys.root]
  const id = env[roomSessionEnvKeys.id]
  const path = env[roomSessionEnvKeys.path]
  if (
    root === undefined ||
    root === "" ||
    id === undefined ||
    id === "" ||
    path === undefined ||
    path === ""
  )
    throw new RoomSessionEnvironmentError(
      "a room worker needs " +
        roomSessionEnvKeys.root +
        ", " +
        roomSessionEnvKeys.id +
        " and " +
        roomSessionEnvKeys.path +
        "; start it through `room run` or `room up`",
    )
  return { root, id, path }
}

/**
 * Open the journal a room handed this process.
 *
 * The documented open call for a worker: `room run` and `room up` set the three variables, and
 * this resolves the same file the control plane opens for pause, resume and status.
 */
export const openRoomSessionFromEnvironment = async (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RoomSession> => openRoomSessionAt(roomSessionEnvironmentFrom(env).path)
