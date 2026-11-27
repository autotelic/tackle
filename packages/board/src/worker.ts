import * as Cloudflare from "@alchemy.run/cloudflare"
import { RoomApi } from "@autotelic/room/Room/RoomApi.api"
import { RoomHandlers, RoomModel } from "@autotelic/room/Room/Room.model"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { RoomDurableObjects } from "./RoomDurableObjects.ts"

/**
 * The Room model hosted on Durable Objects. The Worker is the board's
 * deployment surface; the Room classes are declared by the same model the
 * local store and the stories use, so production does not grow a second state
 * machine.
 */
const RoomLive = RoomModel.layer(RoomHandlers).pipe(Layer.provide(RoomDurableObjects))

/** The board's Worker entry: the Room control plane, served over HTTP. */
export default class BoardWorker extends Cloudflare.Worker<BoardWorker>()(
  "BoardWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const api = yield* RoomApi
    return { fetch: api.fetch }
  }).pipe(Effect.provide(RoomLive)),
) {}
