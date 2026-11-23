import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "../Room/Room.id.ts"

export class RoomEvacuated extends Domain.Event(
  "RoomEvacuated",
  { to: Schema.String, fromGeneration: Schema.Int, sha: Schema.String, at: Schema.Int },
  { description: "The source sealed its journal and released the name at fromGeneration." },
) {}

export class MoveAlreadyStarted extends Domain.Rejection(
  "MoveAlreadyStarted",
  {},
  { httpApiStatus: 409, description: "This room has already left its source." },
) {}

export class EvacuateRoom extends Domain.Command(
  "EvacuateRoom",
  {
    target: RoomId,
    input: {
      roomId: RoomId,
      to: Schema.String,
      fromGeneration: Schema.Int,
      sha: Schema.String,
    },
    events: [RoomEvacuated],
    rejects: [MoveAlreadyStarted],
  },
  { description: "Seal the source and record where the room is going." },
) {}
