import * as Domain from "@alchemy.run/domain"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Room } from "./Room.aggregate.ts"
import { RoomStatus } from "./RoomStatus.ts"

/** The control-plane view: one row per room, with the two columns a reader needs. */
export class RoomView extends Domain.View(
  "RoomView",
  {
    from: [Room],
    key: Room,
    state: Schema.Struct({
      status: RoomStatus,
      repo: Schema.NullOr(Schema.String),
      scope: Schema.NullOr(Schema.String),
    }),
    initial: { status: "archived", repo: null, scope: null },
    evolve: {
      RoomCreated: (_view, event) => ({
        status: "ready" as const,
        repo: event.repo,
        scope: event.scope,
      }),
      RoomPaused: (view) => ({ ...view, status: "paused" as const }),
      RoomResumed: (view) => ({ ...view, status: "ready" as const }),
    },
  },
  { description: "A room's control-plane status, repo and scope." },
) {}

/** Anyone who can read the room can read its summary. */
export const RoomViewLive = RoomView.toLayer(Effect.succeed(() => Effect.void))
