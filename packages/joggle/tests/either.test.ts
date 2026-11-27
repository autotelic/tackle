import { Result } from "effect"
import { expect, test } from "vitest"
import { BuildFailure, lookup, NoMatch } from "../src/either.ts"

test("a lookup returns the value it found", () => {
  expect(lookup(() => "found", "the fixture value")).toEqual(Result.succeed("found"))
})

test("a lookup turns both null and undefined into a named absence", () => {
  for (const absent of [undefined, null]) {
    const missing = lookup(() => absent, "the fixture value")
    expect(Result.isFailure(missing)).toBe(true)
    if (Result.isFailure(missing)) {
      expect(missing.failure).toBeInstanceOf(NoMatch)
      expect(missing.failure.lookedFor).toBe("the fixture value")
    }
  }
})

test("a build failure is tagged and carries the subject it refused", () => {
  const failure = new BuildFailure({
    family: "remedy-clause",
    subject: JSON.stringify("A subject, not a repair"),
    message: "refusing to use the subject as a repair",
  })
  expect(failure._tag).toBe("joggle/BuildFailure")
  expect(failure.family).toBe("remedy-clause")
  expect(failure.subject).toContain("A subject, not a repair")
  expect(failure.message).toContain("refusing")
})
