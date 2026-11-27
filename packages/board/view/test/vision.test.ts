import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import { BoardView, type Model } from "../src/main.ts"

/** The vision route reads no presence; its model is the selected stage and nothing else. */
const model: Model = {
  route: "vision",
  presence: null,
  atlas: null,
  error: null,
  loading: false,
  notice: null,
  visionStep: 0,
  visionFocus: "permissions",
  visionMachine: "mbp1",
}

it.effect("the vision board explains what Alchemy controls", () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(BoardView, {})
    const drawn = scene.given(model)
    const text = Locator.textOf(drawn.root)
    assert.include(text, "Alchemy declares the inventory")
    assert.include(text, "Tackle.Room")
    assert.include(text, "RoomMachine")
    assert.include(text, "How to observe the inventory")
    assert.include(text, "room.json state + process")
    assert.include(text, "Tackle.RoomMachine is now built")
    assert.include(text, "local worktree · :4400 · web")
    assert.include(text, "agentOS preview bridge")
    assert.include(text, "supervisor vmHttp")
  }),
)
