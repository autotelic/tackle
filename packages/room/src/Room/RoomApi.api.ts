import * as Domain from "@alchemy.run/domain"
import { RoomModel } from "./Room.model.ts"

/** The control-plane surface. Lease and move are separate models. */
export class RoomApi extends Domain.Api(
  "RoomApi",
  {
    model: RoomModel,
    commands: ["CreateRoom", "PauseRoom", "ResumeRoom"],
    views: ["RoomView"],
  },
  { description: "Create, pause and resume a durable room." },
) {}
