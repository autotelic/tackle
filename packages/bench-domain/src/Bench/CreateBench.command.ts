import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { BenchId } from "./Bench.id.ts"

export class BenchCreated extends Domain.Event(
  "BenchCreated",
  {
    repo: Schema.String,
    scope: Schema.String,
    at: Schema.Int,
  },
  { description: "A durable place was created for one repo and scope." },
) {}

/** A bench id is a place, not a handle: creating it twice is a mistake, never a no-op. */
export class BenchAlreadyExists extends Domain.Rejection(
  "BenchAlreadyExists",
  {},
  { httpApiStatus: 409, description: "A bench with this id already exists." },
) {}

export class CreateBench extends Domain.Command(
  "CreateBench",
  {
    target: BenchId,
    input: {
      benchId: BenchId,
      repo: Schema.String,
      scope: Schema.String,
    },
    events: [BenchCreated],
    rejects: [BenchAlreadyExists],
  },
  { description: "Create the durable place for one repo and scope." },
) {}
