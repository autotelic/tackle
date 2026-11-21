import * as Schema from "effect/Schema"

/** The control-plane lifecycle. It is not the lease's state or a message's state. */
export const RoomStatus = Schema.Union([
  Schema.Literal("ready"),
  Schema.Literal("paused"),
  Schema.Literal("archived"),
])
export type RoomStatus = typeof RoomStatus.Type
