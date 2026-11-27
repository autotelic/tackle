import { Decision } from "effect/ai"
import { expect, test } from "vitest"
import type { Plan } from "../src/plans.ts"
import {
  atomReferencesOf,
  questionnaireCensus,
  validatePlan,
  validateQuestionnaire,
  type QuestionViolation,
} from "../src/questionnaire.ts"

const plan = (input: {
  readonly atoms?: ReadonlyArray<string>
  readonly decisions: Plan<unknown>["decisions"]
}): Plan<unknown> => ({
  ruleId: "joggle/test",
  subject: "src/example.ts:1",
  concerns: [],
  atoms: input.atoms ?? ["a1"],
  decisions: input.decisions,
  read: () => undefined,
})

const rules = (violations: ReadonlyArray<QuestionViolation>): ReadonlyArray<string> =>
  violations.map((violation) => violation.rule)

test("a conforming plan has no violations", () => {
  const clean = plan({
    decisions: {
      verdict: Decision.probability({
        instructions:
          "Do `atoms[a1].a.message` and `atoms[a1].b.message` prescribe the same repair?",
        criteria: { false: "Different repairs.", true: "The same repair." },
      }),
    },
  })
  expect(validatePlan(clean)).toEqual([])
})

test("one plan per violation: a Locate is not a primitive joggle may send", () => {
  const violations = validateQuestionnaire({
    atoms: ["a1"],
    decisions: {
      where: Decision.locate({ image: "a1", instructions: "Where is `atoms[a1].image`?" }),
    },
    read: () => undefined,
  })
  expect(rules(violations)).toEqual(["primitive"])
})

test("one plan per violation: an instruction must name an atom path", () => {
  const violations = validatePlan(
    plan({
      decisions: {
        verdict: Decision.probability({ instructions: "Is this the same repair?" }),
      },
    }),
  )
  expect(rules(violations)).toEqual(["atom-reference"])
})

test("one plan per violation: an instruction is one snap judgment", () => {
  const violations = validatePlan(
    plan({
      decisions: {
        verdict: Decision.probability({
          instructions: "`atoms[a1].message` " + "x".repeat(400),
        }),
      },
    }),
  )
  expect(rules(violations)).toEqual(["instruction-length"])
})

test("one plan per violation: a Choice offers at most eight options", () => {
  const criteria = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => ["option-" + String(index), "One repair."]),
  )
  const violations = validatePlan(
    plan({
      decisions: {
        verdict: Decision.classify({
          instructions: "Which repair does `atoms[a1].message` need?",
          criteria,
        }),
      },
    }),
  )
  expect(rules(violations)).toEqual(["option-count"])
})

test("one plan per violation: an option description is a description, not an essay", () => {
  const violations = validatePlan(
    plan({
      decisions: {
        verdict: Decision.classify({
          instructions: "Which repair does `atoms[a1].message` need?",
          criteria: { parse: "y".repeat(201), narrow: "Prove the runtime shape." },
        }),
      },
    }),
  )
  expect(rules(violations)).toEqual(["option-description-length"])
})

test("one plan per violation: a question reads only the atoms its plan declared", () => {
  const violations = validatePlan(
    plan({
      atoms: ["a1"],
      decisions: {
        verdict: Decision.probability({
          instructions: "Do `atoms[a1].a` and `atoms[a2].b` prescribe the same repair?",
        }),
      },
    }),
  )
  expect(rules(violations)).toEqual(["declared-atom"])
})

test("the census counts questions, not repeats, and names the first offender", () => {
  const census = questionnaireCensus([
    plan({
      decisions: {
        remedy: Decision.probability({
          instructions: "Do `atoms[a1].a` and `atoms[a1].b` prescribe the same repair?",
        }),
        material: Decision.probability({
          instructions: "Does the `atoms[a1].a.trigger` difference change that repair?",
        }),
      },
    }),
    plan({
      decisions: {
        verdict: Decision.probability({ instructions: "No path here." }),
      },
    }),
  ])
  expect(census.plans).toBe(2)
  expect(census.questions).toBe(3)
  expect(census.violations).toHaveLength(1)
  expect(census.byRule["atom-reference"]).toBe(1)
  expect(census.worst?.subject).toBe("src/example.ts:1")
})

test("an atom path is read without its prose neighbours", () => {
  expect(
    atomReferencesOf(
      "Compare `atoms[a1].a.message` with `atoms[9f].b.trigger`, twice `atoms[a1]`.",
    ),
  ).toEqual(["a1", "9f"])
})
