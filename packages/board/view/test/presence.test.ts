/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the shape, not a generated claim, is what these pin. */
import { Result, Schema } from "effect"
import { expect, test } from "vitest"
import { Presence, environmentsByWorkstream } from "../src/presence.ts"

const workstream = (id: string): string =>
  JSON.stringify({
    id,
    project: "factory",
    label: id,
    phase: "build",
    path: "/Users/togmund/autotelic/" + id,
    checkpoint: { sha: "0".repeat(40), at: "2026-11-22T10:00:00.000Z" },
  })

/**
 * The served document as text.
 *
 * The seam is bytes, so these cases start from bytes: the board writes JSON and the view
 * decodes it, and a test that handed over an already-decoded value would skip the interesting
 * half of that.
 */
const served = (environments?: string): string => {
  const factory =
    '{"workstreams":[' +
    workstream("shakti-perms") +
    '],"activity":[],"desk":[],"reports":[]' +
    (environments === undefined ? "" : ',"environments":' + environments) +
    "}"
  return (
    '{"factory":' +
    factory +
    ',"sessions":{"herdr":{"available":false,"sessions":[]},"rex":{"available":false,"sessions":[]}}}'
  )
}

const environment = JSON.stringify({
  workstream: "shakti-perms",
  machine: { host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" },
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/shakti-perms" },
  services: [],
  agent: { session: "t19", status: "working" },
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
})

const decode = (text: string) => Schema.decodeResult(Schema.fromJsonString(Presence))(text)

/** What the card reads: the served environments, keyed by workstream. */
const environmentOf = (text: string, id: string) => {
  const decoded = decode(text)
  if (Result.isFailure(decoded))
    throw new Error("presence did not decode: " + String(decoded.failure))
  return environmentsByWorkstream(decoded.success.factory.environments)[id]
}

test("a served environment decodes and reaches the card", () => {
  const found = environmentOf(served("[" + environment + "]"), "shakti-perms")
  expect(found?.machine).toEqual({ host: "macbook-pro", dnsName: "macbook-pro.tail.ts.net" })
  expect(found?.runtime).toEqual({
    kind: "worktree",
    path: "/Users/togmund/autotelic/shakti-perms",
  })
  expect(found?.services).toEqual([])
  expect(found?.agent).toEqual({ session: "t19", status: "working" })
  expect(found?.preview).toBeNull()
})

test("a board that serves no environments still decodes, and the card draws no line", () => {
  expect(environmentOf(served(), "shakti-perms")).toBeUndefined()
})

test("a half-served environment keeps its missing parts missing", () => {
  const found = environmentOf(served('[{"workstream":"shakti-perms"}]'), "shakti-perms")
  expect(found?.workstream).toBe("shakti-perms")
  expect(found?.machine).toBeUndefined()
  expect(found?.runtime).toBeUndefined()
  expect(found?.agent).toBeUndefined()
  expect(found?.preview).toBeUndefined()
})

test("a null machine and a null agent decode as null, not as a guessed value", () => {
  const found = environmentOf(
    served('[{"workstream":"shakti-perms","machine":null,"agent":null}]'),
    "shakti-perms",
  )
  expect(found?.machine).toBeNull()
  expect(found?.agent).toBeNull()
})
