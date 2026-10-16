import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { appliesAt, matchesGlob } from "../src/config.ts"
import { layerPurity } from "../src/rules/import-architecture.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(modelStub({ verdict: choice("forbidden", 0.95) })), Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>,
  )

const config = {
  architecture: {
    layers: [
      { name: "domain", include: ["domain/**"], forbid: ["react*", "fastify*"] },
      { name: "app", include: ["app/**"] },
    ],
  },
}

test("a layer's forbidden imports are an import-graph fact", async () => {
  const outcome = await run(
    Effect.gen(function* () {
      const workspace = yield* loadWorkspace("tests/fixtures/layers", ["."])
      return yield* plannedDiagnosticsOf(layerPurity, workspace, { config })
    }),
  )
  // `react*` catches react; the app layer declares nothing and stays free; zod
  // is not forbidden anywhere and must not be reported.
  expect(outcome.diagnostics.length).toBe(1)
  expect(outcome.diagnostics[0]?.location.file).toBe("domain/impure.ts")
  expect(outcome.diagnostics[0]?.message).toContain("react")
  expect(outcome.diagnostics[0]?.help).toContain("react*")
  expect(outcome.diagnostics[0]?.judged).toBe(true)
})

test("a pattern without a wildcard matches only itself", () => {
  // Which is the difference between forbidding one package and forbidding a
  // whole family, and it is worth being able to say either.
  expect(matchesGlob({ glob: "react", subject: "react" })).toBe(true)
  expect(matchesGlob({ glob: "react", subject: "react-dom" })).toBe(false)
  expect(matchesGlob({ glob: "react*", subject: "react-dom" })).toBe(true)
  expect(matchesGlob({ glob: "@remix-run/*", subject: "@remix-run/react" })).toBe(true)
})

test("a rule can be scoped to where it is meant to speak", () => {
  const scoped = { rules: { "joggle/layer-purity": { severity: "warn" as const, paths: ["packages/domain/**"] } } }
  expect(appliesAt({ config: scoped, ruleId: "joggle/layer-purity", path: "packages/domain/user.ts" })).toBe(true)
  // Same rule, same file shape, a path it was not configured for.
  expect(appliesAt({ config: scoped, ruleId: "joggle/layer-purity", path: "services/ui/route.tsx" })).toBe(false)
  // A rule with no paths applies everywhere: scoping is opt-in.
  expect(appliesAt({ config: { rules: { "joggle/layer-purity": "warn" } }, ruleId: "joggle/layer-purity", path: "anything.ts" })).toBe(true)
  expect(appliesAt({ config: {}, ruleId: "joggle/layer-purity", path: "anything.ts" })).toBe(true)
})
