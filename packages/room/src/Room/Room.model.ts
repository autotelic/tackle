import * as Domain from "@alchemy.run/domain"
import * as Layer from "effect/Layer"
import { Room } from "./Room.aggregate.ts"
import { RoomView, RoomViewLive } from "./RoomStatus.view.ts"

/** The room control plane: create, pause, resume, and the status view. */
export class RoomModel extends Domain.Model("RoomModel", {
  aggregates: [Room],
  views: [RoomView],
}) {}

/** Every view implementation the model needs. */
export const RoomHandlers = Layer.mergeAll(RoomViewLive)
