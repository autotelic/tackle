import { expect, test } from "vitest"
import { BuildFailure } from "../src/either.ts"

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
