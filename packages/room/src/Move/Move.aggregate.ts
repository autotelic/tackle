import * as Domain from "@alchemy.run/domain"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { RoomId } from "../Room/Room.id.ts"
import { AdoptRoom, RoomAdopted, MoveDiverged, StaleGeneration } from "./AdoptRoom.command.ts"
import { AdoptionMissing, ArchiveRoom, RoomArchived } from "./ArchiveRoom.command.ts"
import { RoomEvacuated, EvacuateRoom, MoveAlreadyStarted } from "./EvacuateRoom.command.ts"

export const MoveState = Schema.Union([
  Schema.TaggedStruct("Present", {}),
  Schema.TaggedStruct("Evacuated", {
    to: Schema.String,
    fromGeneration: Schema.Int,
    sha: Schema.String,
  }),
  Schema.TaggedStruct("Adopted", { toGeneration: Schema.Int, sha: Schema.String }),
  Schema.TaggedStruct("Divergent", { sourceSha: Schema.String, targetSha: Schema.String }),
  Schema.TaggedStruct("Archived", { sha: Schema.String }),
])
export type MoveState = typeof MoveState.Type

/**
 * The move protocol as a state machine. It has no delete: the source can only
 * be archived after the target's adoption is recorded. A stale generation and a
 * hash mismatch are both refusals, and the mismatch carries both hashes.
 */
export class Move extends Domain.Aggregate("Move", {
  id: RoomId,
  state: MoveState,
  initial: { _tag: "Present" },
  commands: [EvacuateRoom, AdoptRoom, ArchiveRoom],
  decide: {
    EvacuateRoom: Effect.fn(function* (move, command, { now }) {
      if (move._tag !== "Present") return yield* new MoveAlreadyStarted()
      return [
        new RoomEvacuated({
          to: command.to,
          fromGeneration: command.fromGeneration,
          sha: command.sha,
          at: DateTime.toEpochMillis(now),
        }),
      ]
    }),
    AdoptRoom: Effect.fn(function* (move, command, { now }) {
      if (move._tag !== "Evacuated") return yield* new AdoptionMissing()
      if (command.toGeneration <= move.fromGeneration)
        return yield* new StaleGeneration({ from: move.fromGeneration, to: command.toGeneration })
      if (command.sha !== move.sha)
        return [
          new MoveDiverged({
            sourceSha: move.sha,
            targetSha: command.sha,
            at: DateTime.toEpochMillis(now),
          }),
        ]
      return [
        new RoomAdopted({
          toGeneration: command.toGeneration,
          sha: command.sha,
          at: DateTime.toEpochMillis(now),
        }),
      ]
    }),
    ArchiveRoom: Effect.fn(function* (move, _command, { now }) {
      if (move._tag !== "Adopted") return yield* new AdoptionMissing()
      return [new RoomArchived({ at: DateTime.toEpochMillis(now) })]
    }),
  },
  evolve: {
    RoomEvacuated: (move, event): MoveState =>
      move._tag === "Present"
        ? { _tag: "Evacuated", to: event.to, fromGeneration: event.fromGeneration, sha: event.sha }
        : move,
    RoomAdopted: (move, event): MoveState =>
      move._tag === "Evacuated"
        ? { _tag: "Adopted", toGeneration: event.toGeneration, sha: event.sha }
        : move,
    MoveDiverged: (move, event): MoveState =>
      move._tag === "Evacuated"
        ? { _tag: "Divergent", sourceSha: event.sourceSha, targetSha: event.targetSha }
        : move,
    RoomArchived: (move): MoveState =>
      move._tag === "Adopted" ? { _tag: "Archived", sha: move.sha } : move,
  },
}) {}
