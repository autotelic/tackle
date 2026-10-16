import { expect, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { policy } from "../src/policy.ts"

/**
 * Every policy leaf must be read from outside policy.ts.
 *
 * `policy.ts` is where a threshold, a vocabulary or a declared convention lives
 * so that it is reviewable and overridable. A leaf nobody reads is the opposite:
 * it looks tunable, and editing it does nothing. Two were found this way --
 * `fieldTypeDrift.minWords`, which the planner never consulted while it compared
 * every `id` and `paths` in the tree as if the name were a concept, and
 * `singlePath.nonStringReturns`, which a rule refinement left behind.
 *
 * The walk is structural, so a nested leaf counts: `policy.a.b` is read when the
 * tree contains `policy.a.b`.
 */

/** Every source file a leaf could be read from, policy.ts excepted. */
const readers = (): string => {
  const walk = (dir: string): Array<string> =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = dir + "/" + entry.name
      if (entry.isDirectory()) return walk(path)
      if (!entry.name.endsWith(".ts") || path === "src/policy.ts") return []
      return [readFileSync(path, "utf8")]
    })
  return [...walk("src"), ...walk("tests")].join("\n")
}

/** The dotted paths of every leaf in the policy object. */
const leaves = (value: unknown, prefix: string): Array<string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix]
  const entries = Object.entries(value)
  if (entries.length === 0) return [prefix]
  return entries.flatMap(([key, child]) => leaves(child, prefix === "" ? key : prefix + "." + key))
}

it("every policy leaf is read outside policy.ts", () => {
  const text = readers()
  const unread = leaves(policy, "").filter((path) => {
    // The leaf counts as read when the longest prefix names it, which is how a
    // whole object (`policy.decision.thresholds`) can be read in one expression.
    const parts = path.split(".")
    for (let length = parts.length; length > 0; length -= 1) {
      const candidate = "policy." + parts.slice(0, length).join(".")
      if (new RegExp("\\b" + candidate.replace(/\./g, "\\.") + "\\b").test(text)) return false
    }
    return true
  })
  expect(unread).toEqual([])
})
