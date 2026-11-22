/* oxlint-disable plumb/prefer-property-tests -- fixed routes and observations; the exact route a reader is sent to is the claim. */
import { Option } from "effect"
import { expect, test } from "vitest"
import { previewOf, previewRequestOf, previewRoute } from "../src/preview.ts"

test("a preview request keeps the workstream encoded and forwards the rest of the path", () => {
  expect(Option.getOrNull(previewRequestOf("/preview/shakti-perms/assets/app.js?v=2"))).toEqual({
    segment: "shakti-perms",
    path: "/assets/app.js?v=2",
  })
  expect(Option.getOrNull(previewRequestOf("/preview/shakti-perms/"))).toEqual({
    segment: "shakti-perms",
    path: "/",
  })
})

test("a route without its trailing slash, or outside the prefix, is not a preview", () => {
  for (const url of [
    "/preview/shakti-perms",
    "/preview/",
    "/presence",
    "/factory/preview/x/",
    "/preview//x/",
  ])
    expect(Option.isNone(previewRequestOf(url))).toBe(true)
})

test("a workstream id that needs encoding still round-trips through its route", () => {
  const id = "factory feedback/v2"
  // The router compares the encoded segment, so it never decodes an escape from a request.
  expect(Option.getOrNull(previewRequestOf(previewRoute(id) + "healthz"))).toEqual({
    segment: encodeURIComponent(id),
    path: "/healthz",
  })
})

test("only a healthy observation advertises a route", () => {
  const preview = (status: "healthy" | "unhealthy" | "stopped") =>
    Option.getOrNull(previewOf({ workstream: "shakti-perms", services: [{ status }] }))
  expect(preview("healthy")).toBe("/preview/shakti-perms/")
  expect(preview("unhealthy")).toBeNull()
  expect(preview("stopped")).toBeNull()
  expect(Option.isNone(previewOf({ workstream: "shakti-perms", services: [] }))).toBe(true)
  expect(Option.isNone(previewOf({ workstream: "", services: [{ status: "healthy" }] }))).toBe(true)
})
