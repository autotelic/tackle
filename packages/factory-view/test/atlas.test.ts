/* oxlint-disable plumb/prefer-property-tests -- one fixed atlas document; the rendered route, not a generated claim, is what this pins. */
import { Result, Schema } from "effect"
import { Scene } from "foldkit/test"
import { expect, test } from "vitest"
import { Atlas } from "../src/atlas.ts"
import { update, view, type Model } from "../src/main.ts"

const served = JSON.stringify({
  generatedAt: "2026-11-23T01:00:00.000Z",
  workspace: ".",
  packages: [
    {
      name: "@autotelic/protocol",
      version: "0.1.1",
      path: "packages/protocol",
      description: "The seam.",
      private: false,
      scripts: ["build", "test"],
      workspaceDependencies: [],
      summary: "The formats every tool agrees on.",
    },
    {
      name: "@autotelic/board",
      version: "0.0.0",
      path: "packages/board",
      private: true,
      scripts: ["build"],
      workspaceDependencies: ["@autotelic/protocol"],
      summary: null,
    },
  ],
  edges: [{ from: "@autotelic/board", to: "@autotelic/protocol" }],
})

const model = (): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Atlas))(served)
  if (Result.isFailure(decoded)) throw new Error("atlas did not decode: " + String(decoded.failure))
  return {
    route: "tackle",
    presence: null,
    atlas: decoded.success,
    error: null,
    loading: false,
    notice: null,
  }
}

test("the tackle route draws every package and its workspace edges", () => {
  let markup = ""
  Scene.scene(
    { update, view },
    Scene.given(model()),
    Scene.tap((simulation) => {
      markup = JSON.stringify(simulation.html)
    }),
  )
  expect(markup).toContain("Tackle")
  expect(markup).toContain("protocol")
  expect(markup).toContain("board")
  expect(markup).toContain("2 packages")
  expect(markup).toContain("depends on")
  expect(markup).toContain("used by")
})
