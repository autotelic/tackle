import { Story } from "@alchemy.run/domain/Story"
import { expect, it } from "@effect/vitest"
import { Move } from "../src/Move/Move.aggregate.ts"
import { MoveModel } from "../src/Move/Move.model.ts"
import {
  AdoptRoom,
  RoomAdopted,
  MoveDiverged,
  StaleGeneration,
} from "../src/Move/AdoptRoom.command.ts"
import { AdoptionMissing, ArchiveRoom, RoomArchived } from "../src/Move/ArchiveRoom.command.ts"
import {
  RoomEvacuated,
  EvacuateRoom,
  MoveAlreadyStarted,
} from "../src/Move/EvacuateRoom.command.ts"

const story = Story.make(MoveModel)
const move = Move.ref("acme-web-dev-1575")
const T0 = 1_767_225_600_000
const source = "sha256:source"
const other = "sha256:other"

it.effect("a move adopts at the next generation, then archives; nothing deletes", () =>
  story(
    Story.when(
      move,
      new EvacuateRoom({ roomId: move.id, to: "mini", fromGeneration: 1, sha: source }),
    ),
    Story.then(move, new RoomEvacuated({ to: "mini", fromGeneration: 1, sha: source, at: T0 })),
    Story.when(
      move,
      new EvacuateRoom({ roomId: move.id, to: "mini", fromGeneration: 1, sha: source }),
    ),
    Story.rejected(new MoveAlreadyStarted()),
    Story.when(move, new AdoptRoom({ roomId: move.id, toGeneration: 2, sha: source })),
    Story.then(move, new RoomAdopted({ toGeneration: 2, sha: source, at: T0 })),
    Story.when(move, new ArchiveRoom({ roomId: move.id })),
    Story.then(move, new RoomArchived({ at: T0 })),
  ),
)

it.effect(
  "refuses a stale generation, records a mismatch with both hashes, and refuses to archive",
  () =>
    story(
      Story.when(
        move,
        new EvacuateRoom({ roomId: move.id, to: "mini", fromGeneration: 1, sha: source }),
      ),
      Story.then(move, new RoomEvacuated({ to: "mini", fromGeneration: 1, sha: source, at: T0 })),

      // A receipt at the source's generation is a copy, not a handoff.
      Story.when(move, new AdoptRoom({ roomId: move.id, toGeneration: 1, sha: source })),
      Story.rejected(new StaleGeneration({ from: 1, to: 1 })),

      // Different bytes: both hashes are recorded, and the source is not archived.
      Story.when(move, new AdoptRoom({ roomId: move.id, toGeneration: 2, sha: other })),
      Story.then(move, new MoveDiverged({ sourceSha: source, targetSha: other, at: T0 })),
      Story.when(move, new ArchiveRoom({ roomId: move.id })),
      Story.rejected(new AdoptionMissing()),
    ),
)

it.effect("refuses to adopt before the source has left", () =>
  story(
    Story.when(move, new AdoptRoom({ roomId: move.id, toGeneration: 2, sha: source })),
    Story.rejected(new AdoptionMissing()),
  ),
)

it("the model is well defined", () => expect(MoveModel).toBeDefined())
