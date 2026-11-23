import * as Domain from "@alchemy.run/domain"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { RoomId } from "./Room.id.ts"
import { RoomCreated, RoomAlreadyExists, CreateRoom } from "./CreateRoom.command.ts"
import { RoomNotPaused, RoomResumed, ResumeRoom } from "./ResumeRoom.command.ts"
import { RoomNotFound } from "./RoomNotFound.rejection.ts"
import { RoomNotRunning, RoomPaused, PauseRoom } from "./PauseRoom.command.ts"

/**
 * The control-plane state. It is deliberately not the lease's state and not a
 * message's state: a paused room can hold no lease, and an acked message says
 * nothing about whether the room is ready.
 */
export const RoomState = Schema.Union([
  Schema.TaggedStruct("Absent", {}),
  Schema.TaggedStruct("Ready", {
    repo: Schema.String,
    scope: Schema.String,
    createdAt: Schema.Int,
  }),
  Schema.TaggedStruct("Paused", {
    repo: Schema.String,
    scope: Schema.String,
    createdAt: Schema.Int,
    pausedAt: Schema.Int,
  }),
])
export type RoomState = typeof RoomState.Type

/**
 * One durable place. Create, pause and resume are the only control-plane
 * transitions in the first model; the lease and the move are separate
 * aggregates so their state machines cannot be merged into this one.
 */
export class Room extends Domain.Aggregate("Room", {
  id: RoomId,
  state: RoomState,
  initial: { _tag: "Absent" },
  commands: [CreateRoom, PauseRoom, ResumeRoom],
  decide: {
    CreateRoom: Effect.fn(function* (room, command, { now }) {
      if (room._tag !== "Absent") return yield* new RoomAlreadyExists()
      return [
        new RoomCreated({
          repo: command.repo,
          scope: command.scope,
          at: DateTime.toEpochMillis(now),
        }),
      ]
    }),
    PauseRoom: Effect.fn(function* (room, _command, { now }) {
      if (room._tag === "Absent") return yield* new RoomNotFound()
      if (room._tag !== "Ready") return yield* new RoomNotRunning()
      return [new RoomPaused({ at: DateTime.toEpochMillis(now) })]
    }),
    ResumeRoom: Effect.fn(function* (room, _command, { now }) {
      if (room._tag === "Absent") return yield* new RoomNotFound()
      if (room._tag !== "Paused") return yield* new RoomNotPaused()
      return [new RoomResumed({ at: DateTime.toEpochMillis(now) })]
    }),
  },
  evolve: {
    RoomCreated: (room, event): RoomState =>
      room._tag === "Absent"
        ? { _tag: "Ready", repo: event.repo, scope: event.scope, createdAt: event.at }
        : room,
    RoomPaused: (room, event): RoomState =>
      room._tag === "Ready"
        ? {
            _tag: "Paused",
            repo: room.repo,
            scope: room.scope,
            createdAt: room.createdAt,
            pausedAt: event.at,
          }
        : room,
    RoomResumed: (room, _event): RoomState =>
      room._tag === "Paused"
        ? { _tag: "Ready", repo: room.repo, scope: room.scope, createdAt: room.createdAt }
        : room,
  },
}) {}
