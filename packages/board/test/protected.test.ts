/* oxlint-disable plumb/prefer-property-tests -- two pattern shapes (a directory and an exact path), each against its boundary; the fixture is the claim. */
import { expect, test } from "vitest"
import { isProtectedPath } from "../src/factory/kernel.ts"
import { recordOf } from "../src/factory/store.ts"

// The patterns are the subject, so the fixture puts them on the record. Without this the
// record carried the store's default trunk list and the assertions were green for the wrong
// reason.
const record = (protectedPaths: ReadonlyArray<string>) => ({
  ...recordOf({
    id: "probe",
    facts: {
      project: "factory",
      label: "factory-feedback",
      repo: "autotelic/tackle",
      path: "/tmp/tackle",
      branch: "main",
      head: "abc",
      delivery: "trunk",
      pr: undefined,
      base: "main",
      baseSha: "abc",
      prHead: "abc",
      phase: "build",
      at: "2026-11-22T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/probe", at: "…", pushed: false },
    },
  }),
  protectedPaths: [...protectedPaths],
})

// Both cases use a pattern the store's default trunk list does not contain, so a fixture that
// stopped carrying them would fail here instead of passing on the default.
test("a directory pattern protects its children, not a sibling with the same prefix", () => {
  const subject = { record: record(["packages/board/**"]), path: "" }
  expect(isProtectedPath({ ...subject, path: "packages/board/src/cli.ts" })).toBe(true)
  expect(isProtectedPath({ ...subject, path: "packages/board-old/src/cli.ts" })).toBe(false)
})

test("an exact pattern protects only that path", () => {
  const subject = { record: record(["docs/environment-plan.md"]), path: "" }
  expect(isProtectedPath({ ...subject, path: "docs/environment-plan.md" })).toBe(true)
  expect(isProtectedPath({ ...subject, path: "docs/other.md" })).toBe(false)
})
