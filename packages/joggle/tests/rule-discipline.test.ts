import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { allRules } from "../src/rules/index.ts"

/**
 * The rule joggle makes of itself.
 *
 * A rule declares with `judged` whether it needs the model. A rule that says
 * `false` must run on a machine with no API key, so it must not reach a Decision
 * directly or through the decision module. That direction is checkable from the
 * source and this test enforces it.
 *
 * The other direction is not checkable here, and is a judgement: whether a rule
 * that only states a fact has moved a verdict into code. `joggle/rule-judgment`
 * asks the model that question, which is the same discipline applied one level up.
 */
const RULES = readdirSync("src/rules").filter((name) => name.endsWith(".ts") && name !== "index.ts")

describe("the discipline joggle asks of its own rules", () => {
  test("a rule that does not judge never reaches the model", () => {
    for (const name of RULES) {
      const text = readFileSync("src/rules/" + name, "utf8")
      if (!text.includes("defineRule(")) continue
      if (/judged:\s*true/.test(text)) continue
      const reaches = text.includes("DecisionModel") || text.includes('from "../decision.ts"')
      expect(reaches, name + " declares judged: false but reaches the model").toBe(false)
    }
  })

  test("every rule in the registry declares whether it judges", () => {
    expect(allRules.length).toBeGreaterThan(0)
    for (const rule of allRules) {
      expect(typeof rule.judged, rule.id + " has no judged flag").toBe("boolean")
    }
  })
})
