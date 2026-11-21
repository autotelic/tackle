import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { BenchId } from "./Bench.id.ts"

export class BenchPaused extends Domain.Event(
  "BenchPaused",
  { at: Schema.Int },
  { description: "The bench stopped doing work; its storage stays." },
) {}

export class BenchNotRunning extends Domain.Rejection(
  "BenchNotRunning",
  {},
  { httpApiStatus: 409, description: "Only a ready bench can be paused." },
) {}

export class PauseBench extends Domain.Command(
  "PauseBench",
  {
    target: BenchId,
    input: { benchId: BenchId, at: Schema.Int },
    events: [BenchPaused],
    rejects: [BenchNotRunning],
  },
  { description: "Pause a ready bench. Pausing does not delete anything." },
) {}
