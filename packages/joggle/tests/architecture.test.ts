import { describe, expect, test } from "vitest"
import { cyclesIn, directionViolations, layerOf, layersFrom } from "../src/architecture.ts"
import type { ImportGraph } from "../src/imports.ts"
import { allRules } from "../src/rules/index.ts"

const graphOf = (pairs: ReadonlyArray<readonly [string, string, boolean?]>): ImportGraph => ({
  edges: pairs.map(([importer, to, typeOnly]) => ({
    importer,
    specifier: to,
    to,
    resolution: "resolved",
    names: [],
    typeOnly: typeOnly === true,
  })),
  importersOf: new Map(),
  importersOfName: () => [],
  unresolved: 0,
})

const config = {
  architecture: {
    layers: [
      { name: "domain", include: ["src/domain/**"] },
      { name: "kernel", include: ["src/kernel/**"] },
      { name: "entry", include: ["src/main.ts"] },
    ],
  },
}

const layers = layersFrom(config)

describe("a declared layering", () => {
  test("reads bottom-up, so rank is declaration order", () => {
    expect(layers.map((layer) => layer.rank)).toEqual([0, 1, 2])
    expect(layerOf(layers, "src/domain/a.ts")?.name).toBe("domain")
    expect(layerOf(layers, "src/main.ts")?.name).toBe("entry")
    expect(layerOf(layers, "README.md")).toBeUndefined()
  })

  test("an import downward is the point", () => {
    expect(directionViolations(graphOf([["src/main.ts", "src/kernel/a.ts"]]), layers)).toEqual([])
    expect(directionViolations(graphOf([["src/kernel/a.ts", "src/domain/b.ts"]]), layers)).toEqual([])
  })

  test("an import upward is the violation", () => {
    const found = directionViolations(graphOf([["src/domain/a.ts", "src/kernel/b.ts"]]), layers)
    expect(found).toEqual([
      { from: "src/domain/a.ts", to: "src/kernel/b.ts", fromLayer: "domain", toLayer: "kernel" },
    ])
  })

  test("a file in no declared layer is not guessed at", () => {
    // Inventing a rank for a file nobody placed would report a rule nobody wrote.
    expect(directionViolations(graphOf([["scripts/x.ts", "src/main.ts"]]), layers)).toEqual([])
  })

  test("nothing to check when no layers are declared", () => {
    expect(directionViolations(graphOf([["a.ts", "b.ts"]]), layersFrom({}))).toEqual([])
  })
})

describe("module cycles", () => {
  test("a loop is found, and reported once", () => {
    const cycles = cyclesIn(
      graphOf([
        ["a.ts", "b.ts"],
        ["b.ts", "c.ts"],
        ["c.ts", "a.ts"],
      ]),
    )
    expect(cycles.length).toBe(1)
    expect([...(cycles[0]?.loop ?? [])].sort()).toEqual(["a.ts", "b.ts", "c.ts"])
  })

  test("the same loop entered elsewhere is the same loop", () => {
    // A 3-cycle has 3 entry points; rotating to the smallest member is what
    // stops it being reported three times.
    const cycles = cyclesIn(
      graphOf([
        ["b.ts", "c.ts"],
        ["c.ts", "a.ts"],
        ["a.ts", "b.ts"],
      ]),
    )
    expect(cycles.length).toBe(1)
  })

  test("a diamond is not a cycle", () => {
    // The classic false positive: a -> b -> d and a -> c -> d. Two paths, no loop.
    expect(
      cyclesIn(
        graphOf([
          ["a.ts", "b.ts"],
          ["a.ts", "c.ts"],
          ["b.ts", "d.ts"],
          ["c.ts", "d.ts"],
        ]),
      ),
    ).toEqual([])
  })

  test("two loops in one graph are two cycles", () => {
    const cycles = cyclesIn(
      graphOf([
        ["a.ts", "b.ts"],
        ["b.ts", "a.ts"],
        ["c.ts", "d.ts"],
        ["d.ts", "c.ts"],
      ]),
    )
    expect(cycles.length).toBe(2)
  })

  test("a loop made only of erased imports is not in the runtime graph", () => {
    // `import type` leaves no module initialisation behind, so this loop cannot
    // cause the load-order problem the rule exists to catch.
    const cycles = cyclesIn(
      graphOf([
        ["a.ts", "b.ts", true],
        ["b.ts", "a.ts", true],
      ]),
    )
    expect(cycles.length).toBe(1)
    expect(cycles[0]?.typeOnly).toBe(true)
    expect(cycles[0]?.runtime).toBe(false)
  })

  test("one erased edge is enough to break the loop at load time", () => {
    // Removing any single edge leaves no loop to load out of order, so a MIXED
    // loop is not a runtime cycle either. Which of the two edges is erased does
    // not matter, and both directions are tested because the first version of
    // this classification got it backwards.
    for (const erasedFirst of [true, false]) {
      const cycles = cyclesIn(
        graphOf([
          ["a.ts", "b.ts", erasedFirst],
          ["b.ts", "a.ts", !erasedFirst],
        ]),
      )
      expect(cycles[0]?.runtime, `erasedFirst=${erasedFirst}`).toBe(false)
      expect(cycles[0]?.typeOnly).toBe(false)
    }
  })

  test("a loop of real imports IS a runtime cycle", () => {
    const cycles = cyclesIn(
      graphOf([
        ["a.ts", "b.ts", false],
        ["b.ts", "a.ts", false],
      ]),
    )
    expect(cycles[0]?.runtime).toBe(true)
    expect(cycles[0]?.typeOnly).toBe(false)
  })
})

test("both architecture rules are registered", () => {
  const ids = allRules.map((rule) => rule.id)
  expect(ids).toContain("joggle/layer-direction")
  expect(ids).toContain("joggle/import-cycle")
  // Judged now: the edge is a fact, whether it is a violation is the question.
  for (const id of ["joggle/layer-direction", "joggle/import-cycle"]) {
    expect(allRules.find((rule) => rule.id === id)?.judged).toBe(true)
  }
})
