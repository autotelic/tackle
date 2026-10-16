import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { pageNeedsComposition } from "../src/rules/page-needs-composition.ts"
import { diagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noConfig, noul } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/page-needs-composition", ["src"])

const model = modelStub({
  role: choice("route_page", 0.95),
  verdict: choice("extract_to_bundle", 0.95),
  worth_fixing: noul(0.95),
  primary_gap: choice("no_provider_root", 0.95),
})

it.effect("a page under state pressure is reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const diagnostics = yield* diagnosticsOf(pageNeedsComposition, workspace, {
      model,
      context: noConfig,
    })
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]?.message).toContain("3 useState call(s)")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a page the model reads as its own state is dropped", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const diagnostics = yield* diagnosticsOf(pageNeedsComposition, workspace, {
      model: modelStub({
        role: choice("route_page", 0.95),
        verdict: choice("no_issue", 0.95),
        worth_fixing: noul(0.95),
        primary_gap: choice("no_provider_root", 0.95),
      }),
      context: noConfig,
    })
    expect(diagnostics).toEqual([])
  }).pipe(Effect.provide(NodeServices.layer)),
)
