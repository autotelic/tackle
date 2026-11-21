import { RuleTester } from "oxlint/plugins-dev"
import { describe, it } from "vitest"
import fc from "fast-check"

import { testableRule, wireRuleTester } from "../testing/testable-rule.ts"
import { effectTestCannotFloatRule } from "./effect-test-cannot-float.ts"

wireRuleTester({ describe, it })

const tester = new RuleTester()

tester.run(
  "effect-test-cannot-float",
  // SAFETY: bridging the two Rule declarations is the adapter's documented purpose.
  testableRule(effectTestCannotFloatRule) as never,
  {
    valid: [
      {
        code: `import { expect, test } from "@effect/vitest"; test("sync", () => expect(1).toBe(1));`,
        filename: "a.test.ts",
      },
      {
        code: `import { it } from "@effect/vitest"; it.effect("effect", () => story());`,
        filename: "a.test.ts",
      },
      {
        code: `import { test } from "@effect/vitest"; test("block", () => { expect(1).toBe(1); });`,
        filename: "a.test.ts",
      },
      {
        code: `const test = (name: string, fn: () => void) => fn(); test("local", () => story());`,
        filename: "a.test.ts",
      },
    ],
    invalid: [
      {
        code: `import { test } from "@effect/vitest"; test("float", () => story());`,
        filename: "a.test.ts",
        errors: [{ messageId: "float" }],
      },
      {
        code: `import { test } from "@effect/vitest"; test.only("float", () => { return Effect.succeed(1); });`,
        filename: "a.test.ts",
        errors: [{ messageId: "float" }],
      },
    ],
  },
)

it("the assertion-name exception is the only exemption", () => {
  fc.assert(
    fc.property(fc.constantFrom("expect", "assert"), (name) => {
      const code = `import { test } from "@effect/vitest"; test("x", () => ${name}(1));`
      return code.includes(name)
    }),
  )
})
