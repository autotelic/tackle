import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { decline, declineNames, declined } from "../src/rule.ts"
import {
  duplicateVocabulary,
  nameVocabulary,
  pageDecisions,
  pageVerdictByRole,
} from "../src/vocabulary.ts"

const sourceOf = (file: string): string => readFileSync(new URL("../" + file, import.meta.url), "utf8")

/** The rule files that ask questions. They read their words from vocabulary.ts. */
const RULES = ["src/rules/cluster-verdict.ts", "src/rules/naming-drift.ts"]

/**
 * Every Choice that can return no finding.
 *
 * `nameVocabulary` is not in this list because its two "one concept" options are
 * built by a template that needs the symbol; the decline it offers is asserted
 * separately below.
 */
const choices: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
  ["duplicate verdict", duplicateVocabulary.verdict],
  ["page role", pageDecisions.role.criteria],
  ["page verdict", pageDecisions.verdict.criteria],
  ["page primary_gap", pageDecisions.primary_gap.criteria],
]

describe("the decline vocabulary", () => {
  test("a decline is an answer, and reads as one", () => {
    expect(declined(decline.noIssue)).toBe(true)
    expect(declined(decline.notApplicable)).toBe(true)
    expect(declined("collapse")).toBe(false)
  })

  test("silence is not a decline", () => {
    // The distinction matters downstream: a decline is "looked, found nothing",
    // while an absent choice is "never got an answer". The first is a result and
    // the second is a skipped rule.
    expect(declined(undefined)).toBe(false)
  })

  test("every choice that can decline names one of the two", () => {
    for (const [label, criteria] of choices) {
      const offers = declineNames.some((name) => name in criteria)
      expect(offers, label + " has no decline option").toBe(true)
    }
    expect(nameVocabulary.noIssue.length).toBeGreaterThan(0)
  })

  test("every role is either judged by its own vocabulary or declined", () => {
    // The classification SELECTS the next question's options, so the two cannot
    // be allowed to drift: a role added without a verdict vocabulary would be
    // judged by criteria written for a different kind of file, and the answer
    // would be true of neither.
    const verdictOptions = Object.keys(pageDecisions.verdict.criteria).sort()
    for (const role of Object.keys(pageDecisions.role.criteria)) {
      if (declineNames.includes(role)) continue
      const criteria = pageVerdictByRole[role]
      expect(criteria, role + " has no verdict vocabulary").toBeDefined()
      expect(Object.keys(criteria ?? {}).sort(), role).toEqual(verdictOptions)
    }
  })

  test("a question that offers a decline states it", () => {
    // The cookbook puts the escape hatch IN the question: "Select noMatch when no
    // hunk provides sufficient evidence". Inferred from the option list is not
    // the same as stated, and the model is reading the question first.
    for (const decision of [pageDecisions.role, pageDecisions.verdict, pageDecisions.primary_gap]) {
      expect(decision.instructions).toContain("Choose")
    }
  })

  test("no rule invents a fifth name for the same idea", () => {
    const legacy = ["not_duplication", "distinct\":", "keep_local"]
    for (const file of [...RULES, "src/vocabulary.ts"]) {
      const source = sourceOf(file)
      for (const name of legacy) {
        expect(source.includes(name), file + " still uses " + name).toBe(false)
      }
    }
  })

  test("rules read their words from the vocabulary", () => {
    // The point of moving the strings out was that two questions can be compared
    // side by side. A rule that inlines its own criteria is a second vocabulary.
    expect(sourceOf("src/rules/page-needs-composition.ts")).toContain("pageDecisions")
    // The option KEY living in a rule would mean a second definition of it.
    expect(sourceOf("src/rules/page-needs-composition.ts")).not.toContain("extract_to_bundle:")
    expect(sourceOf("src/rules/cluster-verdict.ts")).toContain("duplicateVocabulary")
    expect(sourceOf("src/rules/naming-drift.ts")).toContain("nameVocabulary")
  })
})
