import { expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { canonical } from "../src/canonical.ts"
import {
  corpusManifest,
  generate,
  truth,
  type SinglePathState,
  type SyntheticItem,
} from "../src/synthetic/single-path.ts"

/**
 * The verification split: one seed, one count, and every assertion below reads
 * the generator's output rather than the recipe that produced it. A test that
 * re-ran the generator's own branches would agree with itself; these check the
 * predicate against every item the corpus actually holds.
 */
const items = generate({ seed: 1, count: 100 })

/** A copy of an item whose helper returns nothing at all. */
const emptied = (item: SyntheticItem): SinglePathState => {
  const first = Object.entries(item.state.atoms)[0]
  if (first === undefined) return item.state
  const [key, atom] = first
  const helper = atom.helpers[0]
  if (helper === undefined) return item.state
  return {
    atoms: {
      [key]: {
        site: atom.site,
        helpers: [
          {
            name: helper.name,
            file: helper.file,
            body: `function ${helper.name}(value) {\n  return\n}`,
          },
        ],
      },
    },
  }
}

it("re-derives every item's label from its state", () => {
  const mismatched = items.filter((item) => truth(item.state) !== item.label)
  expect(mismatched.map((item) => item.provenance.family)).toEqual([])
  expect(items.length).toBe(100)
})

it("is deterministic from the seed alone, and seed-sensitive", () => {
  const replay = corpusManifest({ items: generate({ seed: 1, count: 100 }), seed: 1 })
  const current = corpusManifest({ items, seed: 1 })
  const other = corpusManifest({ items: generate({ seed: 2, count: 100 }), seed: 2 })
  expect(replay.corpusHash).toBe(current.corpusHash)
  expect(other.corpusHash).not.toBe(current.corpusHash)
})

it("emits no duplicate state", () => {
  const states = new Set(items.map((item) => canonical(item.state)))
  expect(states.size).toBe(items.length)
  expect(corpusManifest({ items, seed: 1 }).duplicates).toBe(0)
})

it("balances the labels within ten per cent, with the adversarial negative present", () => {
  const counts = corpusManifest({ items, seed: 1 }).counts
  expect(Math.abs(counts.reimplements - counts.legitimate_local)).toBeLessThanOrEqual(
    items.length * 0.1,
  )
  expect(counts.near_miss).toBeGreaterThan(0)
  expect(counts.reimplements + counts.legitimate_local).toBe(items.length)
})

it("never carries the label or a field naming it inside the state", () => {
  const leaked = items.filter((item) => {
    // The tags are the answer. `JSON.stringify` and not `canonical` because this
    // is what a reader (and a tokenizer) sees, in the order the state has it.
    const text = JSON.stringify(item.state)
    return text.includes("reimplements") || text.includes("legitimate_local")
  })
  expect(leaked.map((item) => item.provenance.family)).toEqual([])
})

it("rejects a re-implements item whose helper body was emptied", () => {
  const original = items.find((item) => item.label === "reimplements")
  expect(original).toBeDefined()
  if (original === undefined) return
  const corrupted = emptied(original)
  expect(canonical(corrupted)).not.toBe(canonical(original.state))
  expect(truth(corrupted)).toBe("legitimate_local")
})

it("commits the seed-1 split the generator emits", () => {
  const committed = readFileSync(
    new URL("../testdata/single-path-corpus.jsonl", import.meta.url),
    "utf8",
  )
  const manifest = JSON.parse(
    readFileSync(
      new URL("../testdata/single-path-corpus.jsonl.manifest.json", import.meta.url),
      "utf8",
    ),
  )
  expect(committed).toBe(items.map((item) => JSON.stringify(item)).join("\n") + "\n")
  expect(manifest).toEqual(corpusManifest({ items, seed: 1 }))
})
