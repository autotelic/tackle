import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { importerGraph } from "./catalog.ts"
import { parseModule } from "./crawl.ts"
import { featuresOf } from "./features.ts"

const options = {
  roots: ["components"],
  routeDir: "routes",
  entries: [],
  composition: { providerSuffix: "Provider", hookPrefix: "use" },
}

const modules = [
  parseModule({
    filename: "components/feature/context.ts",
    text: [
      'import { createContext } from "react"',
      "export const FeatureContext = createContext({})",
      "export function useFeature() { return FeatureContext }",
    ].join("\n"),
  }),
  parseModule({
    filename: "components/feature/provider.tsx",
    text: [
      'import { FeatureContext } from "./context"',
      "export function FeatureProvider({ children }: { children: unknown }) {",
      "  return <FeatureContext.Provider value={{}}>{children}</FeatureContext.Provider>",
      "}",
    ].join("\n"),
  }),
  parseModule({
    filename: "components/feature/block.tsx",
    text: [
      'import { useFeature } from "./context"',
      "export function Block() { useFeature(); return <div /> }",
    ].join("\n"),
  }),
  parseModule({
    filename: "components/feature/stranger.tsx",
    text: "export function Stranger() { return <span /> }",
  }),
]

describe("featuresOf", () => {
  const graph = importerGraph(modules, {})

  it("counts only components that consume the composition's context", () => {
    const features = featuresOf(modules, options, graph)
    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({
      dir: "components/feature",
      blocks: ["components/feature/block.tsx"],
    })
  })

  it("does not let arbitrary same-directory modules become blocks", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 10_000 }), { maxLength: 12 }), (suffixes) => {
        const strangers = suffixes.map((suffix) =>
          parseModule({
            filename: `components/feature/extra-${String(suffix)}.tsx`,
            text: "export function Extra() { return <span /> }",
          }),
        )
        const all = [...modules, ...strangers]
        const features = featuresOf(all, options, importerGraph(all, {}))
        return features.length === 1 && features[0]?.blocks.length === 1
      }),
    )
  })
})
