import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"
import { BenchId } from "../Bench/Bench.id.ts"

export class BenchArchived extends Domain.Event(
  "BenchArchived",
  { at: Schema.Int },
  { description: "The source copy is in cold storage. Archiving is a move, never a delete." },
) {}

export class AdoptionMissing extends Domain.Rejection(
  "AdoptionMissing",
  {},
  {
    httpApiStatus: 409,
    description: "Nothing may be archived until the target's adoption is recorded.",
  },
) {}

export class ArchiveBench extends Domain.Command(
  "ArchiveBench",
  {
    target: BenchId,
    input: { benchId: BenchId },
    events: [BenchArchived],
    rejects: [AdoptionMissing],
  },
  { description: "Archive the source after adoption. There is no delete command." },
) {}
