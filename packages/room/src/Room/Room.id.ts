import * as Schema from "effect/Schema"

/** One durable place, addressed by the same name across hosts. */
export const RoomId = Schema.String.pipe(Schema.brand("RoomId"))
export type RoomId = typeof RoomId.Type
