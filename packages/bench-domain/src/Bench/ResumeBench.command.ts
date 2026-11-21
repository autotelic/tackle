import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { BenchId } from "./Bench.id.ts"

export class BenchResumed extends Domain.Event(
  "BenchResumed",
  { at: Schema.Int },
  { description: "A paused bench is ready to work again." },
) {}

export class BenchNotPaused extends Domain.Rejection(
  "BenchNotPaused",
  {},
  { httpApiStatus: 409, description: "Only a paused bench can be resumed." },
) {}

export class ResumeBench extends Domain.Command(
  "ResumeBench",
  {
    target: BenchId,
    input: { benchId: BenchId, at: Schema.Int },
    events: [BenchResumed],
    rejects: [BenchNotPaused],
  },
  { description: "Resume a paused bench." },
) {}
