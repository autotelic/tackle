import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "./Room.id.ts"
import { RoomNotFound } from "./RoomNotFound.rejection.ts"

export class RoomResumed extends Domain.Event(
  "RoomResumed",
  { at: Schema.Int },
  { description: "A paused room is ready to work again." },
) {}

export class RoomNotPaused extends Domain.Rejection(
  "RoomNotPaused",
  {},
  { httpApiStatus: 409, description: "Only a paused room can be resumed." },
) {}

export class ResumeRoom extends Domain.Command(
  "ResumeRoom",
  {
    target: RoomId,
    input: { roomId: RoomId },
    events: [RoomResumed],
    rejects: [RoomNotFound, RoomNotPaused],
  },
  { description: "Resume a paused room." },
) {}
