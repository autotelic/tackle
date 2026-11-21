import * as Domain from "@alchemy.run/domain"

/** The id names no bench. It is not a paused or ready bench; it does not exist. */
export class BenchNotFound extends Domain.Rejection(
  "BenchNotFound",
  {},
  { httpApiStatus: 404, description: "No bench has this id." },
) {}
