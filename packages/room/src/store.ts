import { DateTime } from "effect"
import { Schema } from "effect"
import * as Result from "effect/Result"
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PortClaim, PortLease, portClaimFile, portRange, portsDir } from "./PortLease.ts"
import { Room } from "./Room/Room.aggregate.ts"
import { RoomId } from "./Room/Room.id.ts"
import { CreateRoom } from "./Room/CreateRoom.command.ts"
import { PauseRoom } from "./Room/PauseRoom.command.ts"
import { ResumeRoom } from "./Room/ResumeRoom.command.ts"
import { RoomState } from "./Room/Room.aggregate.ts"
import { ServiceDeclaration } from "./Service.ts"
import { VmSnapshot, type VmSnapshotOutcome } from "./VmSnapshot.ts"
import {
  declaredSoftware,
  defaultRoomSoftware,
  RoomSoftware,
  type VmSoftwareReport,
} from "./VmSoftware.ts"

/**
 * Where a room is placed.
 *
 * Absent is the local git worktree — the placement every room had before a runtime could be
 * recorded — so a room file written by an older `room` decodes unchanged.
 */
export const RoomRuntime = Schema.Struct({
  kind: Schema.Literal("agentos"),
  /** The guest port a started VM service answers on; absent until `room vm serve`. */
  previewPort: Schema.optional(Schema.Int),
  /**
   * What software the VM booted with, as its own registry reported it.
   *
   * The declaration is the room file's; this is the runtime's answer to it, so an operator can
   * read what the guest actually has instead of assuming the boot installed it. Optional, so a
   * room file written before a VM was placed decodes unchanged.
   */
  software: Schema.optional(VmSoftwareReport),
  /**
   * The guest pid of that service, as the VM's own process table named it.
   *
   * It is a guest number, not a host pid: the VM's table is the authority for whether the
   * service is still there, so the room keeps the id it must ask about rather than a number a
   * log printed once. Optional, so a room file written before the pid was kept decodes
   * unchanged — and then the room can still report health, but has no process to stop.
   */
  servicePid: Schema.optional(Schema.Int),
  /**
   * The root filesystem the last pause captured, beside this file.
   *
   * A room file that names a snapshot is a room whose disk is durably somewhere else; a file
   * without one has only what the VM left in `agentos.sqlite`.
   */
  snapshot: Schema.optional(VmSnapshot),
  /**
   * Why the last pause captured no snapshot.
   *
   * The room is paused either way. This field is the difference between a pause that kept the
   * disk and a pause that did not, so a reader is never left to assume the first.
   */
  snapshotError: Schema.optional(Schema.String),
})
export type RoomRuntime = typeof RoomRuntime.Type

const RoomFileSchema = Schema.Struct({
  id: Schema.String,
  base: Schema.String,
  state: RoomState,
  exec: Schema.optional(Schema.String),
  desired: Schema.optional(Schema.Boolean),
  port: Schema.optional(PortLease),
  service: Schema.optional(ServiceDeclaration),
  runtime: Schema.optional(RoomRuntime),
  /**
   * The software this room declares its guest needs.
   *
   * Optional because a room file written before the declaration existed has no field; a reader
   * takes that to mean the default declaration (`roomSoftware`), never a bare VM.
   */
  software: Schema.optional(RoomSoftware),
})

/** The file a room is: its id, its base branch, and the control-plane state. */
export type RoomFile = typeof RoomFileSchema.Type

/**
 * The declaration a room's VM is booted with.
 *
 * An absent field is the default declaration, not a bare VM: the rooms written before the field
 * existed still boot with the tools their work needs.
 */
export const roomSoftware = (room: RoomFile | undefined): RoomSoftware =>
  declaredSoftware(room?.software)

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
  /** The room's own declaration; absent writes the default one, so the file names it. */
  readonly software?: RoomSoftware | undefined
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
  // The declaration is written at the boundary rather than left to a boot: a room file that
  // names its software is one whose guest can be read without starting a VM.
  const room: RoomFile = {
    id: input.id,
    base: input.base,
    state: decided.value,
    software: input.software ?? defaultRoomSoftware,
  }
  await write({ root: input.root, room })
  return { ok: true, value: room }
}

/** Read one port claim; a malformed claim is debris, not an error, because a crash wrote it. */
const readPortClaim = async (input: {
  readonly root: string
  readonly port: number
}): Promise<PortClaim | undefined> => {
  const text = await readFile(portClaimFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(PortClaim))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

type ClaimOutcome = "claimed" | "adopted" | "held"

/**
 * Take the exclusive claim file for one port, reclaiming a claim whose room no longer holds it.
 *
 * "held" is the refusal the caller turns into the next candidate. An unreadable holder counts as
 * live: taking a port from a room this process cannot see is the one failure a lease prevents.
 */
const claimPort = async (input: {
  readonly root: string
  readonly port: number
  readonly room: string
  readonly at: number
}): Promise<ClaimOutcome> => {
  await mkdir(portsDir(input.root), { recursive: true })
  const file = portClaimFile(input)
  for (let attempt = 0; attempt < 2; attempt++) {
    const written = await writeFile(
      file,
      JSON.stringify({ room: input.room, at: input.at }, null, 2) + "\n",
      { flag: "wx" },
    ).then(
      () => true,
      (cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") return false
        throw cause
      },
    )
    if (written) return "claimed"
    const holder = await readPortClaim(input)
    // A malformed claim names no owner to ask, so it is a crash's debris.
    if (holder === undefined) {
      await unlink(file).catch(() => undefined)
      continue
    }
    if (holder.room === input.room) return "adopted"
    let holderRoom: RoomFile | undefined | "unreadable"
    // SAFETY: an unreadable holder is treated as live, never stolen from.
    try {
      holderRoom = await readRoom({ root: input.root, id: holder.room })
    } catch {
      holderRoom = "unreadable"
    }
    if (holderRoom === "unreadable") return "held"
    if (holderRoom !== undefined && holderRoom.port?.number === input.port) return "held"
    // The claim outlived the room's lease; the port is free again.
    await unlink(file).catch(() => undefined)
  }
  return "held"
}

/** Remove a claim file, but only while it still names the room asking to release it. */
const releasePortClaim = async (input: {
  readonly root: string
  readonly port: number
  readonly room: string
}): Promise<void> => {
  const holder = await readPortClaim(input)
  if (holder !== undefined && holder.room !== input.room) return
  await unlink(portClaimFile(input)).catch(() => undefined)
}

/**
 * Lease one port to a room, idempotently.
 *
 * A port another room's file already names is skipped before a claim is attempted, so a room
 * whose claim file was lost still owns its number. The lowest free port wins; a full range is a
 * refusal, never a second owner.
 */
export const leaseRoomPort = async (input: {
  readonly root: string
  readonly id: string
  readonly at: number
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom({ root: input.root, id: input.id })
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  if (room.port !== undefined) return { ok: true, value: room }
  const claimedElsewhere = new Set<number>()
  for (const other of await listRooms(input.root)) {
    if (other.id === input.id || other.port === undefined) continue
    claimedElsewhere.add(other.port.number)
  }
  for (let port = portRange.first; port <= portRange.last; port++) {
    if (claimedElsewhere.has(port)) continue
    const next: RoomFile = { ...room, port: { number: port, leasedAt: input.at } }
    // The room names the port before the claim file is created. Another allocator asks the
    // room whether a claim is live, so writing in this order means it can never mistake a claim
    // that is still being taken for a crashed one and hand the same port to a second room.
    await write({ root: input.root, room: next })
    let outcome: ClaimOutcome
    // SAFETY: a failed claim must give the room its previous, portless record back.
    try {
      outcome = await claimPort({ root: input.root, port, room: input.id, at: input.at })
    } catch (cause) {
      await write({ root: input.root, room })
      throw cause
    }
    if (outcome !== "held") return { ok: true, value: next }
    // Another room won the claim between the scan and the write: give it back and move on.
    await write({ root: input.root, room })
  }
  return { ok: false, error: "PortsExhausted" }
}

/** Release the room's port: the room stops naming it before the claim file disappears. */
export const releaseRoomPort = async (input: {
  readonly root: string
  readonly id: string
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  if (room.port === undefined) return { ok: true, value: room }
  const { port: _port, ...rest } = room
  const next: RoomFile = rest
  await write({ root: input.root, room: next })
  await releasePortClaim({ root: input.root, port: room.port.number, room: input.id })
  return { ok: true, value: next }
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
  const next: RoomFile = { ...room, state: decided.value }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/** Remember the command `up` should run after a `down`. */
export const setRoomExec = async (input: {
  readonly root: string
  readonly id: string
  readonly exec: string
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const next: RoomFile = { ...room, exec: input.exec }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/**
 * Declare the room's one service.
 *
 * A service supersedes the bare `exec`: two fields naming one command would eventually name two
 * different ones, and the projection could not say which process it was observing.
 */
export const setRoomService = async (input: {
  readonly root: string
  readonly id: string
  readonly service: ServiceDeclaration
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom({ root: input.root, id: input.id })
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const { exec: _exec, ...rest } = room
  const next: RoomFile = { ...rest, service: input.service }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/**
 * Record where the room is placed.
 *
 * The runtime is a fact about the room, not a command run against it: writing it here is what
 * lets `room status` name the VM a later command will actually use.
 */
export const setRoomRuntime = async (input: {
  readonly root: string
  readonly id: string
  readonly runtime: RoomRuntime
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom({ root: input.root, id: input.id })
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  // Runtime facts accumulate: `room vm` records placement without forgetting the preview
  // port a previous `room vm serve` wrote.
  const next: RoomFile = { ...room, runtime: { ...room.runtime, ...input.runtime } }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/** Remember whether the shop should keep this room's command running. */
export const setRoomDesired = async (input: {
  readonly root: string
  readonly id: string
  readonly desired: boolean
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const next: RoomFile = { ...room, desired: input.desired }
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
  const next: RoomFile = { ...room, state: decided.value }
  await write({ root: input.root, room: next })
  return { ok: true, value: next }
}

/**
 * Record what a pause captured, or why it captured nothing.
 *
 * The two outcomes replace each other: a snapshot and an error in one record would say both that
 * this pause kept the disk and that it did not. The previous snapshot's file stays on disk — a
 * resumed VM may still be reading it — so only the claim in this file is withdrawn.
 */
export const recordRoomSnapshot = async (input: {
  readonly root: string
  readonly id: string
  readonly outcome: VmSnapshotOutcome
}): Promise<StoreResult<RoomFile>> => {
  const room = await readRoom(input)
  if (room === undefined) return { ok: false, error: "RoomNotFound" }
  const base: RoomRuntime = room.runtime ?? { kind: "agentos" }
  // The previous capture and its reason are both withdrawn here: this pause either kept the disk
  // or it did not, and one record must not say it did both.
  const { snapshot: _snapshot, snapshotError: _snapshotError, ...runtime } = base
  const next: RoomFile = {
    ...room,
    runtime: input.outcome.ok
      ? { ...runtime, snapshot: input.outcome.snapshot }
      : { ...runtime, snapshotError: input.outcome.reason },
  }
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
