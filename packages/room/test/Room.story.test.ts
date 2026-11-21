import * as Domain from "@alchemy.run/domain"
import { Story } from "@alchemy.run/domain/Story"
import { describe, expect, it } from "@effect/vitest"
import { Room } from "../src/Room/Room.aggregate.ts"
import { RoomModel, RoomHandlers } from "../src/Room/Room.model.ts"
import { RoomView } from "../src/Room/RoomStatus.view.ts"
import { RoomAlreadyExists, RoomCreated, CreateRoom } from "../src/Room/CreateRoom.command.ts"
import { RoomNotRunning, RoomPaused, PauseRoom } from "../src/Room/PauseRoom.command.ts"
import { RoomNotFound } from "../src/Room/RoomNotFound.rejection.ts"
import { RoomNotPaused, RoomResumed, ResumeRoom } from "../src/Room/ResumeRoom.command.ts"

const story = Story.make(RoomModel, { layer: RoomHandlers })
const room = Room.ref("acme-web-dev-1575")
const absent = Room.ref("absent")
const T0 = 1_767_225_600_000 // the story clock starts here
const T1 = T0 + 60_000
const T2 = T1 + 60_000

describe("Room", () => {
  it("the model is well defined", () => expect(Domain.verify(RoomModel)).toEqual([]))

  it.effect("creates once, pauses a ready room, resumes a paused one", () =>
    story(
      Story.when(room, new CreateRoom({ roomId: room.id, repo: "acme/web", scope: "dev-1575" })),
      Story.then(room, new RoomCreated({ repo: "acme/web", scope: "dev-1575", at: T0 })),
      Story.view(RoomView, room, {
        status: "ready",
        repo: "acme/web",
        scope: "dev-1575",
      }),

      // A place is not a handle: the second create is refused, not ignored.
      Story.when(room, new CreateRoom({ roomId: room.id, repo: "acme/web", scope: "dev-1575" })),
      Story.rejected(new RoomAlreadyExists()),

      Story.clock(T1),
      Story.when(room, new PauseRoom({ roomId: room.id })),
      Story.then(room, new RoomPaused({ at: T1 })),
      Story.view(RoomView, room, { status: "paused" }),

      Story.clock(T1),
      Story.when(room, new PauseRoom({ roomId: room.id })),
      Story.rejected(new RoomNotRunning()),

      Story.clock(T2),
      Story.when(room, new ResumeRoom({ roomId: room.id })),
      Story.then(room, new RoomResumed({ at: T2 })),
      Story.view(RoomView, room, { status: "ready" }),

      Story.clock(T2),
      Story.when(room, new ResumeRoom({ roomId: room.id })),
      Story.rejected(new RoomNotPaused()),
    ),
  )

  it.effect("refuses to pause a room that does not exist", () =>
    story(
      Story.when(absent, new PauseRoom({ roomId: absent.id })),
      Story.rejected(new RoomNotFound()),
    ),
  )
})
