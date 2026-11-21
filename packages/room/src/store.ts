import { DateTime } from "effect"
import { Schema } from "effect"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Room } from "./Room/Room.aggregate.ts"
import { RoomId } from "./Room/Room.id.ts"
import { CreateRoom } from "./Room/CreateRoom.command.ts"
import { PauseRoom } from "./Room/PauseRoom.command.ts"
import { ResumeRoom } from "./Room/ResumeRoom.command.ts"
import { RoomState } from "./Room/Room.aggregate.ts"

const RoomFileSchema = Schema.Struct({ id: Schema.String, base: Schema.String, state: RoomState })

/** The file a room is: its id, its base branch, and the control-plane state. */
export type RoomFile = typeof RoomFileSchema.Type

export interface Refusal {
  readonly ok: false
  readonly error: string
}
export type StoreResult<A> = { readonly ok: true; readonly value: A } | Refusal

/** The directory a room owns. */
export const roomDir = (input: { readonly root: string; readonly id: string }): string =>
  join(input.root, input.id)

/** The room's own file. */
export const roomFile = (input: { readonly root: string; readonly id: string }): string =>
  join(roomDir(input), "room.json")

/** A room file that exists but does not decode is an input error, not a missing room. */
export class RoomDecodeError extends Error {
  readonly _tag = "RoomDecodeError"
}

/** Read one room; absence is undefined, malformed content is RoomDecodeError. */
export const readRoom = async (input: {
  readonly root: string
  readonly id: string
}): Promise<RoomFile | undefined> => {
  let text: string
  // SAFETY: the file system is an integration boundary; absence is the expected first-read case.
  try {
    text = await readFile(roomFile(input), "utf8")
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined
    throw cause
  }
  // SAFETY: a committed room file that does not decode is malformed input, not absence.
  try {
    return Schema.decodeUnknownSync(RoomFileSchema)(JSON.parse(text))
  } catch (cause) {
    throw new RoomDecodeError(String(cause))
  }
}

/** Every decodable room under the root, in id order. */
export const listRooms = async (root: string): Promise<ReadonlyArray<RoomFile>> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const rooms: RoomFile[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const room = await readRoom({ root, id: entry.name })
    if (room !== undefined) rooms.push(room)
  }
  return rooms.sort((a, b) => a.id.localeCompare(b.id))
}

const write = async (input: { readonly root: string; readonly room: RoomFile }): Promise<void> => {
  await mkdir(roomDir({ root: input.root, id: input.room.id }), { recursive: true })
  await writeFile(
    roomFile({ root: input.root, id: input.room.id }),
    JSON.stringify(input.room, null, 2) + "\n",
  )
}

/** Ask the Room aggregate what a command does to a state; the store never re-implements it. */
const decide = (
  state: RoomState,
  command: CreateRoom | PauseRoom | ResumeRoom,
  id: string,
  at: number,
): StoreResult<RoomState> => {
  const outcome = Room.predict(state, command, {
    id: RoomId.make(id),
    now: DateTime.makeUnsafe(at),
  })
  if (outcome._tag === "Accepted") return { ok: true, value: outcome.state }
  if (outcome._tag === "Rejected") return { ok: false, error: outcome.rejection._tag }
  return { ok: false, error: "Unpredictable" }
}

/** Create a ready room; an existing id is a refusal, never an overwrite. */
export const createRoom = async (input: {
  readonly root: string
  readonly id: string
  readonly repo: string
  readonly scope: string
  readonly base: string
  readonly at: number
}): Promise<StoreResult<RoomFile>> => {
  if ((await readRoom({ root: input.root, id: input.id })) !== undefined)
    return { ok: false, error: "RoomAlreadyExists" }
  const decided = decide(
    { _tag: "Absent" },
    new CreateRoom({ roomId: RoomId.make(input.id), repo: input.repo, scope: input.scope }),
    input.id,
    input.at,
  )
  if (!decided.ok) return decided
  const room: RoomFile = { id: input.id, base: input.base, state: decided.value }
  await write({ root: input.root, room })
  return { ok: true, value: room }
}

/** Pause a ready room through the aggregate; any other state is a refusal. */
export const pauseRoom = async (input: {
  readonly root: string
  readonly id: string
  readonly at: number
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const decided = decide(
    room.state,
    new PauseRoom({ roomId: RoomId.make(input.id) }),
    input.id,
    input.at,
  )
  if (!decided.ok) return decided
  const next: RoomFile = { id: input.id, base: room.base, state: decided.value }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/** Resume a paused room through the aggregate; any other state is a refusal. */
export const resumeRoom = async (input: {
  readonly root: string
  readonly id: string
  readonly at: number
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const decided = decide(
    room.state,
    new ResumeRoom({ roomId: RoomId.make(input.id) }),
    input.id,
    input.at,
  )
  if (!decided.ok) return decided
  const next: RoomFile = { id: input.id, base: room.base, state: decided.value }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

export interface MoveToken {
  readonly name: string
  readonly to: string
  readonly at: number
  readonly generation: number
  readonly state: RoomState
}

/** Write the move intent; the copy itself is the shop's, not this file's. */
export const moveRoom = async (input: {
  readonly root: string
  readonly id: string
  readonly to: string
  readonly at: number
}): Promise<StoreResult<MoveToken>> => {
  const room = await readRoom(input)
  if (room === undefined || room.state._tag === "Absent")
    return { ok: false, error: "RoomNotFound" }
  const token: MoveToken = {
    name: input.id,
    to: input.to,
    at: input.at,
    generation: 1,
    state: room.state,
  }
  await mkdir(roomDir(input), { recursive: true })
  await writeFile(join(roomDir(input), "move.json"), JSON.stringify(token, null, 2) + "\n")
  return { ok: true, value: token }
}
