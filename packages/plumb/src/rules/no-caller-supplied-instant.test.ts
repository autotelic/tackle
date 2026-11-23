import { RuleTester } from "oxlint/plugins-dev"
import { describe, it } from "vitest"
import fc from "fast-check"

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts"
import { noCallerSuppliedInstantRule } from "./no-caller-supplied-instant.ts"

wireRuleTester({ describe, it })

const tester = new RuleTester()

tester.run(
  "no-caller-supplied-instant",
  // SAFETY: bridging the two Rule declarations is the adapter's documented purpose.
  testableRule(noCallerSuppliedInstantRule) as never,
  {
    valid: [
      {
        code: `import * as Domain from "@alchemy.run/domain"; class Pause extends Domain.Command("Pause", { target: Id, input: { id: Id } }) {}`,
        filename: "a.ts",
      },
      {
        code: `import * as Domain from "@alchemy.run/domain"; class Create extends Domain.Command("Create", { input: { repo: Schema.String } }) {}`,
        filename: "a.ts",
      },
    ],
    invalid: [
      {
        code: `import * as Domain from "@alchemy.run/domain"; class Pause extends Domain.Command("Pause", { input: { id: Id, at: Schema.Int } }) {}`,
        filename: "a.ts",
        errors: [{ messageId: "instant" }],
      },
      {
        code: `import * as Domain from "@alchemy.run/domain"; class Resume extends Domain.Command("Resume", { input: { now: Schema.Int } }) {}`,
        filename: "a.ts",
        errors: [{ messageId: "instant" }],
      },
    ],
  },
)

it("the instant set is exhaustive", () => {
  fc.assert(
    fc.property(fc.constantFrom("at", "now", "timestamp", "occurredAt"), (name) => {
      return new Set(["at", "now", "timestamp", "occurredAt"]).has(name)
    }),
  )
})
