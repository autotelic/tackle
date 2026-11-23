import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "./Room.id.ts"
import { RoomNotFound } from "./RoomNotFound.rejection.ts"

export class RoomPaused extends Domain.Event(
  "RoomPaused",
  { at: Schema.Int },
  { description: "The room stopped doing work; its storage stays." },
) {}

export class RoomNotRunning extends Domain.Rejection(
  "RoomNotRunning",
  {},
  { httpApiStatus: 409, description: "Only a ready room can be paused." },
) {}

export class PauseRoom extends Domain.Command(
  "PauseRoom",
  {
    target: RoomId,
    input: { roomId: RoomId },
    events: [RoomPaused],
    rejects: [RoomNotFound, RoomNotRunning],
  },
  { description: "Pause a ready room. Pausing does not delete anything." },
) {}
