import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "../Room/Room.id.ts"
import { AdoptionMissing } from "./ArchiveRoom.command.ts"

export class RoomAdopted extends Domain.Event(
  "RoomAdopted",
  { toGeneration: Schema.Int, sha: Schema.String, at: Schema.Int },
  { description: "The target holds the same bytes at the next generation." },
) {}

export class MoveDiverged extends Domain.Event(
  "MoveDiverged",
  { sourceSha: Schema.String, targetSha: Schema.String, at: Schema.Int },
  { description: "The target's bytes differ; the copy is quarantined, never merged." },
) {}

export class StaleGeneration extends Domain.Rejection(
  "StaleGeneration",
  { from: Schema.Int, to: Schema.Int },
  {
    httpApiStatus: 409,
    description: "Adoption must be at fromGeneration + 1, not at the source's generation.",
  },
) {}

export class AdoptRoom extends Domain.Command(
  "AdoptRoom",
  {
    target: RoomId,
    input: {
      roomId: RoomId,
      toGeneration: Schema.Int,
      sha: Schema.String,
    },
    events: [RoomAdopted, MoveDiverged],
    rejects: [StaleGeneration, AdoptionMissing],
  },
  { description: "Adopt the copy at the next generation, if the bytes match." },
) {}
