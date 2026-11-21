import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "../Room/Room.id.ts"

export class RoomArchived extends Domain.Event(
  "RoomArchived",
  { at: Schema.Int },
  { description: "The source copy is in cold storage. Archiving is a move, never a delete." },
) {}

export class AdoptionMissing extends Domain.Rejection(
  "AdoptionMissing",
  {},
  {
    httpApiStatus: 409,
    description: "Nothing may be archived until the target's adoption is recorded.",
  },
) {}

export class ArchiveRoom extends Domain.Command(
  "ArchiveRoom",
  {
    target: RoomId,
    input: { roomId: RoomId },
    events: [RoomArchived],
    rejects: [AdoptionMissing],
  },
  { description: "Archive the source after adoption. There is no delete command." },
) {}
