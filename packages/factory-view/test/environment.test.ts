/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the rendered line, not a generated claim, is what these pin. */
import { Result, Schema } from "effect"
import { Scene } from "foldkit/test"
import { expect, test } from "vitest"
import { update, view, type Model } from "../src/main.ts"
import { Presence } from "../src/presence.ts"

/**
 * The served document as text.
 *
 * The seam is bytes: the board writes JSON and the view decodes it, so these cases start from
 * the document the board serves and read the markup the card renders from it.
 */
const served = (environments?: string): string => {
  const workstream = JSON.stringify({
    id: "shakti-perms",
    project: "factory",
    label: "shakti-perms",
    phase: "build",
    path: "/Users/togmund/autotelic/shakti-perms",
    checkpoint: { sha: "0".repeat(40), at: "2026-11-22T10:00:00.000Z" },
  })
  const factory =
    '{"workstreams":[' +
    workstream +
    '],"activity":[],"desk":[],"reports":[]' +
    (environments === undefined ? "" : ',"environments":' + environments) +
    "}"
  return (
    '{"factory":' +
    factory +
    ',"sessions":{"herdr":{"available":false,"sessions":[]},"rex":{"available":false,"sessions":[]}}}'
  )
}

const model = (environments?: string): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Presence))(served(environments))
  if (Result.isFailure(decoded))
    throw new Error("presence did not decode: " + String(decoded.failure))
  return { presence: decoded.success, error: null, loading: false, notice: null }
}

const environment = JSON.stringify({
  workstream: "shakti-perms",
  machine: { host: "macbook-pro", dnsName: "macbook-pro.tailbd1623.ts.net" },
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/shakti-perms" },
  services: [],
  agent: { session: "t19", status: "working" },
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
})

/**
 * Render the card for one served document and return its markup as text.
 *
 * The bytes are the assertion surface: a line the projection did not send has to be absent from
 * the markup, not merely null in a model the polyfill could have filled in.
 */
const draw = (environments?: string): string => {
  let markup = ""
  Scene.scene(
    { update, view },
    Scene.given(model(environments)),
    Scene.tap((simulation) => {
      markup = JSON.stringify(simulation.html)
    }),
  )
  return markup
}

test("the card draws the served machine, runtime and agent", () => {
  const markup = draw("[" + environment + "]")
  expect(markup).toContain('"Environment"')
  expect(markup).toContain('"machine macbook-pro"')
  expect(markup).toContain('"worktree /Users/togmund/autotelic/shakti-perms"')
  expect(markup).toContain('"agent t19 · working"')
})

test("a board that serves no environments draws no Environment line", () => {
  const markup = draw()
  expect(markup).not.toContain('"Environment"')
  expect(markup).not.toContain('"environment"')
})

test("a half-served environment draws no Environment line", () => {
  expect(draw('[{"workstream":"shakti-perms"}]')).not.toContain('"Environment"')
})

test("an agent with no status names only its session", () => {
  const statusless = JSON.stringify({
    ...JSON.parse(environment),
    agent: { session: "t19", status: "" },
  })
  const markup = draw("[" + statusless + "]")
  expect(markup).toContain('"agent t19"')
  expect(markup).not.toContain("agent t19 ·")
})
