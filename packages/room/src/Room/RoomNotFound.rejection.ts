import * as Domain from "@alchemy.run/domain"

/** The id names no room. It is not a paused or ready room; it does not exist. */
export class RoomNotFound extends Domain.Rejection(
  "RoomNotFound",
  {},
  { httpApiStatus: 404, description: "No room has this id." },
) {}
