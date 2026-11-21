import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { RoomId } from "./Room.id.ts"

export class RoomCreated extends Domain.Event(
  "RoomCreated",
  {
    repo: Schema.String,
    scope: Schema.String,
    at: Schema.Int,
  },
  { description: "A durable place was created for one repo and scope." },
) {}

/** A room id is a place, not a handle: creating it twice is a mistake, never a no-op. */
export class RoomAlreadyExists extends Domain.Rejection(
  "RoomAlreadyExists",
  {},
  { httpApiStatus: 409, description: "A room with this id already exists." },
) {}

export class CreateRoom extends Domain.Command(
  "CreateRoom",
  {
    target: RoomId,
    input: {
      roomId: RoomId,
      repo: Schema.String,
      scope: Schema.String,
    },
    events: [RoomCreated],
    rejects: [RoomAlreadyExists],
  },
  { description: "Create the durable place for one repo and scope." },
) {}
