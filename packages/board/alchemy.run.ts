import * as Cloudflare from "@alchemy.run/cloudflare"
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import BoardWorker from "./src/worker.ts"

/**
 * The shop's stack. It declares the board Worker and, through the Worker's
 * Room model, the Durable Object classes that host it. C3 still keeps the
 * authoring path on local state: a plan names the resources without a deploy.
 */
export default Alchemy.Stack(
  "room-shop",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), DomainCloudflare.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* BoardWorker
    return { url: worker.url }
  }),
)
