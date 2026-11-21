import { Story } from "@alchemy.run/domain/Story"
import { expect, it } from "@effect/vitest"
import { Move } from "../src/Move/Move.aggregate.ts"
import { MoveModel } from "../src/Move/Move.model.ts"
import {
  AdoptBench,
  BenchAdopted,
  MoveDiverged,
  StaleGeneration,
} from "../src/Move/AdoptBench.command.ts"
import { AdoptionMissing, ArchiveBench, BenchArchived } from "../src/Move/ArchiveBench.command.ts"
import { BenchEvacuated, EvacuateBench } from "../src/Move/EvacuateBench.command.ts"

const story = Story.make(MoveModel)
const move = Move.ref("acme-web-dev-1575")
const T0 = 1_767_225_600_000
const source = "sha256:source"
const other = "sha256:other"

it.effect("a move adopts at the next generation, then archives; nothing deletes", () =>
  story(
    Story.when(
      move,
      new EvacuateBench({ benchId: move.id, to: "mini", fromGeneration: 1, sha: source }),
    ),
    Story.then(move, new BenchEvacuated({ to: "mini", fromGeneration: 1, sha: source, at: T0 })),
    Story.when(move, new AdoptBench({ benchId: move.id, toGeneration: 2, sha: source })),
    Story.then(move, new BenchAdopted({ toGeneration: 2, sha: source, at: T0 })),
    Story.when(move, new ArchiveBench({ benchId: move.id })),
    Story.then(move, new BenchArchived({ at: T0 })),
  ),
)

it.effect(
  "refuses a stale generation, records a mismatch with both hashes, and refuses to archive",
  () =>
    story(
      Story.when(
        move,
        new EvacuateBench({ benchId: move.id, to: "mini", fromGeneration: 1, sha: source }),
      ),
      Story.then(move, new BenchEvacuated({ to: "mini", fromGeneration: 1, sha: source, at: T0 })),

      // A receipt at the source's generation is a copy, not a handoff.
      Story.when(move, new AdoptBench({ benchId: move.id, toGeneration: 1, sha: source })),
      Story.rejected(new StaleGeneration({ from: 1, to: 1 })),

      // Different bytes: both hashes are recorded, and the source is not archived.
      Story.when(move, new AdoptBench({ benchId: move.id, toGeneration: 2, sha: other })),
      Story.then(move, new MoveDiverged({ sourceSha: source, targetSha: other, at: T0 })),
      Story.when(move, new ArchiveBench({ benchId: move.id })),
      Story.rejected(new AdoptionMissing()),
    ),
)

it.effect("refuses to adopt before the source has left", () =>
  story(
    Story.when(move, new AdoptBench({ benchId: move.id, toGeneration: 2, sha: source })),
    Story.rejected(new AdoptionMissing()),
  ),
)

it("the model is well defined", () => expect(MoveModel).toBeDefined())
