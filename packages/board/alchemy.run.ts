import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * The shop's stack. C3 proves the authoring path with local state; the Worktree
 * resource and the Durable Object hosting arrive with the supervisor in C4.
 */
export default Alchemy.Stack(
  "room-shop",
  { providers: Layer.empty, state: Alchemy.localState() },
  Effect.succeed({}),
)
