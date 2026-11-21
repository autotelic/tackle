import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { BenchId } from "../Bench/Bench.id.ts"

export class BenchEvacuated extends Domain.Event(
  "BenchEvacuated",
  { to: Schema.String, fromGeneration: Schema.Int, sha: Schema.String, at: Schema.Int },
  { description: "The source sealed its journal and released the name at fromGeneration." },
) {}

export class MoveAlreadyStarted extends Domain.Rejection(
  "MoveAlreadyStarted",
  {},
  { httpApiStatus: 409, description: "This bench has already left its source." },
) {}

export class EvacuateBench extends Domain.Command(
  "EvacuateBench",
  {
    target: BenchId,
    input: {
      benchId: BenchId,
      to: Schema.String,
      fromGeneration: Schema.Int,
      sha: Schema.String,
    },
    events: [BenchEvacuated],
    rejects: [MoveAlreadyStarted],
  },
  { description: "Seal the source and record where the bench is going." },
) {}
